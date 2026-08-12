/**
 * GitHub-only skills — adding a skill skills.sh has never heard of.
 *
 * The catalog is normally a strict mirror of skills.sh; this module is the one
 * deliberate exception. When the detail endpoint 404s for a skill the admin
 * wants anyway, `previewGitHubSkill` resolves its SKILL.md straight from the
 * GitHub repo and shows the admin exactly which file would bind, and only
 * after explicit confirmation does `addSkillFromGitHub` insert the row —
 * `installs: 0`, `leaderboard: "github"`, `isGitHubOnly: true`. The
 * confirmation step is deliberate: an automatic fallback would let a mistyped
 * slug silently bind to the wrong SKILL.md.
 *
 * Lifecycle consequences of `isGitHubOnly` (the load-bearing flag) live where
 * the lifecycle lives: the heartbeat + adoption mechanics in skills.ts
 * (`gitHubOnlyHeartbeat`, `gitHubOnlyMarkerPatch`, the `addSkillManually`
 * adoption path), the reconcile skip in reconcile.ts, the delist-cap
 * exemption in `markStaleContentBatch`, and the diagnostics exclusions in
 * devStats.ts. See docs/skill-lifecycle.md "GitHub-only skills".
 *
 * `addSkillManually` itself stays in skills.ts (it predates this module and
 * is wired into the normal skills.sh lifecycle); this module owns everything
 * that exists only because of the GitHub fallback.
 */

import { v, ConvexError } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { assertAdmin } from "./devStats";
import { parseSkillInput } from "../lib/parse-skill-input";
import { isGitHubSource } from "./lib/source";
import {
  fetchRepoMetadata,
  fetchRepoTree,
  RATE_LIMITED,
  fetchRawText,
  indexSkillMds,
  rawGitHubUrl,
  NOT_MODIFIED,
} from "./lib/github";
import {
  getSkillDetail as v1GetSkillDetail,
  SkillsApiNotFoundError,
  SkillsApiRateLimitError,
  withTransientRetry,
  type SkillsAuth,
} from "./lib/skillsApi";
import { loadSkillsAuth } from "./lib/skillsAuth";
import { canonicalSlug, matchesSkillIdExactly } from "./lib/skillMatch";
import { probePathsFor } from "./lib/discoveryPlacement";
import { pickSkillMd } from "./lib/resolvePlacement";
import { aliasCandidate, decideSlug } from "./lib/slugDecision";
import {
  GITHUB_LEADERBOARD,
  gitHubQuotaValidator,
  type GitHubAddQuotaStatus,
} from "./lib/githubQuota";
import { kickPostAddChain } from "./lib/postAdd";
import { toPublicError } from "./lib/publicError";
import {
  extractFrontmatterDescription,
  extractSkillMdName,
  humanizeSlug,
} from "./skills";

// ---------------------------------------------------------------------------
// Shared plumbing (used by both preview and confirm — one pipeline, two
// terminal mappings)
// ---------------------------------------------------------------------------

/** parseSkillInput with its plain Error wrapped so prod preserves the message. */
function parseAdminInput(input: string): {
  source: string;
  skillId: string;
  path?: string;
} {
  try {
    return parseSkillInput(input);
  } catch (err) {
    if (err instanceof Error) throw new ConvexError(err.message);
    throw err;
  }
}

/**
 * Is this skill listed on skills.sh? The one place the 404-vs-listed check
 * (and its error wrapping) lives — preview and confirm both call it, so the
 * two can never disagree about what "listed" means. A 404 is an EXPECTED
 * answer here, so it's a return value; rate limits and transient failures
 * throw ConvexError so the prod toast stays actionable instead of the
 * redacted "Server Error".
 */
async function checkSkillsShListing(
  auth: SkillsAuth,
  source: string,
  skillId: string,
): Promise<"listed" | "not_listed"> {
  try {
    await withTransientRetry(() => v1GetSkillDetail(auth, source, skillId));
    return "listed";
  } catch (err) {
    if (err instanceof SkillsApiNotFoundError) return "not_listed";
    throw err instanceof SkillsApiRateLimitError
      ? new ConvexError(
          "skills.sh is rate-limiting requests. Try again in a minute.",
        )
      : new ConvexError(
          "skills.sh didn't answer (transient failure). Try again.",
        );
  }
}

/** Rethrow a rejected settlement's reason; return a fulfilled one's value. */
function unwrap<T>(settled: PromiseSettledResult<T>): T {
  if (settled.status === "rejected") throw settled.reason;
  return settled.value;
}

// ---------------------------------------------------------------------------
// SKILL.md resolution
// ---------------------------------------------------------------------------

type GitHubSkillResolution =
  | {
      status: "ok";
      skillMdUrl: string;
      path: string;
      name: string;
      // The raw frontmatter `name`, present only when the file actually
      // carried one. Kept separate from `name` (which falls back to a
      // humanized slug) so the slug-alias check in previewGitHubCore can never
      // fire on a value that wasn't in the file.
      fmName?: string;
      description?: string;
      // How this file earned the match. `"dir"` means a folder named exactly
      // like the slug — i.e. the caller pointed at THIS skill. `"frontmatter"`
      // means the file's own `name` matched it, EXACTLY: since the resolver
      // moved to `matchesSkillIdExactly`, a partial name no longer binds, so
      // this arm implies `canonicalSlug(fmName)` already equals the
      // SEPARATOR-FOLDED typed slug — and, since only the name side folds case,
      // that the slug is all-lowercase. The one substitution it can still owe is
      // padding: `canonicalSlug` trims and `kebabCase` does not.
      //
      // previewGitHubCore still only trusts the frontmatter name as a slug on
      // the `"dir"` path. That guard is now belt-and-braces for the write, but
      // it stays load-bearing for the AUTO re-add: `on_skills_sh_as_alias` makes
      // the client re-run the add with no confirm step, so nothing inferred may
      // reach it.
      matchedBy: "dir" | "frontmatter";
      // Would storing `canonicalSlug(fmName)` as the row's slug still make
      // post-insert discovery bind THIS file? Discovery's pass 1 is
      // `skillMdByDir.get(skillId)` (skills.ts), so a *different* SKILL.md
      // sitting in a folder named like the alias would win instead — the
      // preview would vouch for one file and the pipeline would fetch
      // another. False whenever that can't be ruled out, including when the
      // tree was unavailable and we never saw the folder list.
      aliasBindsSameFile: boolean;
      // Did we actually get the repo's file list? Separates the two reasons
      // `aliasBindsSameFile` can be false: a conflict we SAW (retrying changes
      // nothing) versus never having looked (retrying may well work). Only the
      // wording shown to the user depends on this.
      treeListed: boolean;
    }
  | { status: "no_repo" }
  | { status: "no_skill_md" }
  // The repo exists but its file tree couldn't be listed (409 too-large, rate
  // limit, transient error) or came back truncated, AND the direct path probes
  // found nothing. Distinct from no_skill_md because "we couldn't look" must
  // never be reported to the admin as the definitive "we looked and it's not
  // there" — that reads as "check the slug" when the slug may be fine.
  | { status: "tree_unavailable" };

/**
 * Locate one skill's SKILL.md inside a GitHub repo, writing nothing.
 *
 * Matching goes through `matchesSkillIdExactly` (lib/skillMatch.ts), which is
 * discovery's rule minus the prefix arm (both fold separators on the slug side;
 * only this one refuses a partial name). Deliberately STRICTER than discovery,
 * not different for its own sake: this path invents the row's permanent slug
 * from what the caller typed, so a partial name must not bind a file and get
 * stored as though it were the name.
 *
 * Strictness alone does NOT make the two agree — that was the original argument
 * here and it was wrong. Skipping a candidate in a first-match-wins scan selects
 * a LATER file rather than ending the walk, so a stricter side can bind something
 * different rather than merely refusing. What makes them agree is that
 * discovery's pass 2 tries exact matches across EVERY candidate before offering
 * any of them to its loose rule. See `matchesSkillIdExactly`'s doc.
 *
 * This function exists separately because discovery is batch-oriented and writes
 * straight to the DB, whereas this must report a result before any row exists.
 * When the tree is unavailable it mirrors discovery's fallback and probes the
 * conventional paths directly.
 */
async function resolveGitHubSkillMd(
  source: string,
  skillId: string,
  /** See `parseSkillInput`'s `path`. A hint to try before walking the tree. */
  pathHint?: string,
): Promise<GitHubSkillResolution> {
  const [owner, repo] = source.split("/");
  const meta = await fetchRepoMetadata(owner, repo);
  // NOTE: fetchRepoMetadata cannot distinguish 404 from a rate limit (both
  // return null), so the caller's message for no_repo hedges accordingly.
  if (!meta) return { status: "no_repo" };

  const rawUrl = (branch: string, path: string) =>
    rawGitHubUrl(source, branch, path);

  const okResult = (
    branch: string,
    path: string,
    contents: string,
    matchedBy: "dir" | "frontmatter",
    // Folder-name → SKILL.md map from the repo tree, or null when the tree was
    // never listed (the probe fallback) — in which case the alias can't be
    // cleared and is treated as unsafe.
    byDir: Map<string, string> | null,
  ): GitHubSkillResolution => {
    const fmName = extractSkillMdName(contents);
    const alias = fmName ? canonicalSlug(fmName) : null;
    // Safe when there is no alias to adopt, when it's the slug we already
    // have, when no folder claims it (discovery falls through to the
    // frontmatter pass and lands back on this file), or when the folder that
    // claims it holds this very file.
    const aliasBindsSameFile =
      alias === null ||
      alias === skillId ||
      (byDir !== null && (byDir.get(alias) ?? path) === path);
    return {
      status: "ok",
      skillMdUrl: rawUrl(branch, path),
      path,
      name: fmName ?? humanizeSlug(skillId),
      ...(fmName && { fmName }),
      description: extractFrontmatterDescription(contents) ?? undefined,
      matchedBy,
      aliasBindsSameFile,
      treeListed: byDir !== null,
    };
  };

  // A rate-limit refusal is handled exactly like an unfetchable tree here: this
  // is a single admin-triggered add, not a walk, so there is no remaining work
  // to abandon and the caller's existing "could not read the repo" path is the
  // right outcome.
  const treeOrLimited = await fetchRepoTree(owner, repo, [meta.defaultBranch]);
  const tree = treeOrLimited === RATE_LIMITED ? null : treeOrLimited;
  // Tree unavailable (too large / rate limited / transient) or truncated:
  // don't claim absence — fall back to probing the conventional layouts
  // directly, the same escape hatch discoverSkillMdUrls uses. All probes run
  // concurrently; results are evaluated in priority order.
  //
  // The list comes from `probePathsFor` rather than being spelled again here.
  // These two paths must bind the SAME file for the same slug
  // (convex/lib/skillMatch.ts) and this side is the UNREPAIRABLE one — a wrong
  // bind writes a permanent slug — so a shared decision expressed twice is the
  // exact shape that let them drift before.
  //
  // A slug that cannot be a safe path segment yields just `SKILL.md`, so the walk
  // below still runs — and the root arm makes that file earn the match through
  // `matchesSkillIdExactly`, which is what keeps an odd slug from resolving to
  // whatever happens to sit in the repo root.
  if (!tree || tree === NOT_MODIFIED || tree.truncated) {
    const probePaths = probePathsFor(skillId);
    const bodies = await Promise.all(
      probePaths.map((path) => fetchRawText(rawUrl(meta.defaultBranch, path))),
    );
    for (let i = 0; i < probePaths.length; i++) {
      const contents = bodies[i];
      if (contents === null) continue;
      const path = probePaths[i];
      // The two conventional dirs match by construction (dir name == slug).
      // A root SKILL.md must earn the match via frontmatter name, same rule
      // as pass 2 below — otherwise any repo with a root SKILL.md would
      // "resolve" every slug typed at it whenever the tree is down.
      if (path !== "SKILL.md") {
        return okResult(meta.defaultBranch, path, contents, "dir", null);
      }
      const fmName = extractSkillMdName(contents);
      if (fmName && matchesSkillIdExactly(fmName, skillId)) {
        return okResult(
          meta.defaultBranch,
          path,
          contents,
          "frontmatter",
          null,
        );
      }
    }
    return { status: "tree_unavailable" };
  }

  const { candidates, byDir } = indexSkillMds(tree.entries);
  if (candidates.length === 0) return { status: "no_skill_md" };

  // Which file to bind, and in what order to look — folder rule, then the pasted
  // URL's hint, then a capped scan — is `pickSkillMd` (lib/resolvePlacement.ts),
  // where it is unit-tested. All that is left here is the download and mapping its
  // answer onto this function's statuses.
  const pick = await pickSkillMd({
    skillId,
    candidates,
    byDir,
    pathHint,
    readBody: async (path) => {
      const contents = await fetchRawText(rawUrl(tree.branch, path));
      if (contents === null) return null;
      return { contents, name: extractSkillMdName(contents) };
    },
  });

  switch (pick.status) {
    case "found":
      return okResult(
        tree.branch,
        pick.path,
        pick.contents,
        pick.matchedBy,
        byDir,
      );
    case "dir_unreadable":
      // The tree said the file exists but raw serves an error — transient CDN
      // trouble, not proof of absence, so do not answer `no_skill_md`.
      return { status: "tree_unavailable" };
    case "none":
      return { status: "no_skill_md" };
  }
}

// ---------------------------------------------------------------------------
// Preview (read-only) and confirm (writes) actions
// ---------------------------------------------------------------------------

type GitHubPreview =
  | { status: "not_github" }
  | { status: "on_skills_sh" }
  // skills.sh lists this SKILL.md, but under the slug its frontmatter `name`
  // implies rather than the folder name the caller's URL carried. Its own
  // status rather than an optional field on `on_skills_sh`: the two need
  // different copy (one says "retry", the other has already been retried) and
  // a `status` check beats a presence check the clients can forget.
  | { status: "on_skills_sh_as_alias"; source: string; skillId: string }
  // source/skillId identify the row that already exists — which is not
  // necessarily the slug the caller typed, so the UI can link to the real one.
  | { status: "already_exists"; name: string; source: string; skillId: string }
  // We know which slug this SKILL.md should have, and can't safely store it.
  // Refused rather than written, because a row under the wrong slug can never
  // be adopted and only a manual re-slug repairs it. `cause` names the
  // obstruction: `"conflict"` is a folder we SAW claim the alias, `"unlisted"`
  // is a file listing we never got — which may be a transient rate limit or a
  // permanently too-large tree, indistinguishable from here.
  | {
      status: "alias_unverifiable";
      source: string;
      skillId: string;
      expectedSkillId: string;
      cause: "unlisted" | "conflict";
    }
  | { status: "no_repo" }
  // Carries the slug it looked for: the copy names it, and it is usually
  // DERIVED (a URL tail, or the repo name for a root SKILL.md) rather than
  // typed, so the user has often never seen the string that failed.
  | { status: "no_skill_md"; skillId: string }
  | { status: "tree_unavailable" }
  | {
      status: "ok";
      source: string;
      skillId: string;
      path: string;
      name: string;
      description?: string;
      // The row exists in the catalog but is delisted, so confirming performs
      // a RELIST — which stamps no `addedBy` and consumes no quota. The UI
      // uses this to keep the confirm available for at-limit users.
      wasDelisted: boolean;
    };

type Precheck = {
  name: string;
  isDelisted: boolean;
  isGitHubOnly: boolean;
} | null;

/**
 * "Does anything already claim this (source, slug)?" — the ONE priority rule,
 * applied per candidate slug. Returns a terminal preview, or null meaning the
 * slug is unclaimed and available for a GitHub-only add.
 *
 * `listing` is a thunk, not a value: a listing FAILURE must never mask an
 * answer the catalog can give on its own, so it stays un-unwrapped until the
 * catalog has had its say — and when the catalog's answer doesn't depend on it
 * at all, the failure is swallowed rather than thrown.
 *
 * The GitHub-only exception mirrors `manualAddCore` in skills.ts: a live
 * GitHub-only row must not short-circuit ahead of the listing check, because
 * that is exactly the row the documented "retry the normal add once skills.sh
 * lists it" adoption path exists to upgrade. Skipping the check would make
 * that recovery a dead end for anyone who reaches it via the alias.
 */
function terminalFor(
  source: string,
  slug: string,
  precheck: Precheck,
  listing: () => "listed" | "not_listed",
  isAlias: boolean,
): GitHubPreview | null {
  const exists = precheck !== null && !precheck.isDelisted;
  const alreadyExists = (): GitHubPreview => ({
    status: "already_exists",
    name: precheck!.name,
    source,
    skillId: slug,
  });

  if (exists && !precheck.isGitHubOnly) return alreadyExists();

  // Past here the row is either absent/delisted, or live-but-GitHub-only. The
  // two cases treat a broken listing check very differently:
  //
  //   - Live GitHub-only row: the answer is `already_exists` whether or not
  //     skills.sh answers. The listing only decides whether the nicer
  //     ADOPTION path can be offered instead, so a rate-limit blip must not
  //     turn a definitive "it's already in your catalog" into an error.
  //   - Anything else: the listing is load-bearing. Swallowing a failure here
  //     would let a blip present a LISTED skill as GitHub-only, which is the
  //     mis-insert this whole module exists to prevent — so it propagates.
  let listed: boolean;
  try {
    listed = listing() === "listed";
  } catch (err) {
    if (!exists) throw err;
    listed = false;
  }

  if (listed) {
    return isAlias
      ? { status: "on_skills_sh_as_alias", source, skillId: slug }
      : { status: "on_skills_sh" };
  }
  // GitHub-only and still not listed — nothing left to upgrade it to.
  if (exists) return alreadyExists();
  return null;
}

/** The same two lookups, run under a second candidate slug. */
async function checkAliasSlug(
  ctx: ActionCtx,
  auth: SkillsAuth,
  source: string,
  alias: string,
): Promise<{ precheck: Precheck; terminal: GitHubPreview | null }> {
  const [precheckR, listingR] = await Promise.allSettled([
    ctx.runQuery(internal.skills.getManualAddPrecheck, {
      source,
      skillId: alias,
    }) as Promise<Precheck>,
    checkSkillsShListing(auth, source, alias),
  ]);
  const precheck = unwrap(precheckR);
  return {
    precheck,
    terminal: terminalFor(source, alias, precheck, () => unwrap(listingR), true),
  };
}

/**
 * The read-only "what would we add?" probe, shared by the admin and public
 * preview actions AND re-run by addGitHubCore at confirm time (so a direct
 * call or a preview-confirm race can neither insert a duplicate nor mis-mark
 * a skill skills.sh actually lists). Callers own the auth gate.
 *
 * The three checks (catalog precheck, skills.sh listing, repo resolution) are
 * independent reads, so they start together and settle before being inspected
 * in priority order: a definitive catalog answer beats a listing answer beats
 * resolution, and a lower-priority check's failure must not mask a
 * higher-priority success. The waste when an early check short-circuits is
 * accepted; the public actions are throttled.
 */
async function previewGitHubCore(
  ctx: ActionCtx,
  input: string,
): Promise<GitHubPreview> {
  const { source, skillId, path: pathHint } = parseAdminInput(input);

  // Well-known sources have no repo to read a SKILL.md out of.
  if (!isGitHubSource(source)) return { status: "not_github" };

  const auth = await loadSkillsAuth(ctx);
  const [precheckR, listingR, resolvedR] = await Promise.allSettled([
    ctx.runQuery(internal.skills.getManualAddPrecheck, {
      source,
      skillId,
    }) as Promise<Precheck>,
    checkSkillsShListing(auth, source, skillId),
    resolveGitHubSkillMd(source, skillId, pathHint),
  ]);

  const precheck = unwrap(precheckR);
  const typedTerminal = terminalFor(
    source,
    skillId,
    precheck,
    () => unwrap(listingR),
    false,
  );
  if (typedTerminal) return typedTerminal;

  const resolved = unwrap(resolvedR);
  if (resolved.status === "no_skill_md") {
    return { status: "no_skill_md", skillId };
  }
  if (resolved.status !== "ok") return { status: resolved.status };

  // Second pass under the SLUG ALIAS.
  //
  // A GitHub deep link only carries the SKILL.md's FOLDER name, but skills.sh
  // derives its slug from the file's frontmatter `name` — and the two diverge
  // whenever a repo namespaces its skills. vercel-labs/agent-skills ships
  // `skills/react-view-transitions/SKILL.md` named
  // `vercel-react-view-transitions`, so every check above ran against a slug
  // skills.sh has never heard of. Left unhandled that produces a confident
  // "not on skills.sh" for a listed skill.
  //
  // Restricted to `matchedBy === "dir"`: only there did the caller point at this
  // exact folder, so its frontmatter name is a statement about the skill they
  // meant. Since the resolver went exact-only, a `"frontmatter"` match implies
  // the name equals the SEPARATOR-FOLDED typed slug, which also forces the slug
  // all-lowercase — leaving only padding (`canonicalSlug` trims, `kebabCase`
  // does not) for this gate to refuse. It is belt-and-braces for the WRITE, but
  // it stays load-bearing for the auto re-add, because `on_skills_sh_as_alias`
  // makes the client re-run the add with no confirm step and nothing inferred
  // may reach an unconfirmed write.
  //
  // Runs only on a genuine mismatch, and deliberately AFTER the typed-slug
  // checks: the slug the caller gave wins whenever it resolves to something.
  const alias = aliasCandidate({
    typedSkillId: skillId,
    canonicalFmName: resolved.fmName ? canonicalSlug(resolved.fmName) : null,
    matchedBy: resolved.matchedBy,
  });
  const aliasPass = alias
    ? await checkAliasSlug(ctx, auth, source, alias)
    : null;
  // A claimed alias is terminal here and never reaches decideSlug.
  if (aliasPass?.terminal) return aliasPass.terminal;

  // The write policy lives in lib/slugDecision.ts — pure, and unit-tested,
  // because the refusal branch can otherwise only be reached by making
  // GitHub's tree API fail mid-add.
  const decision = decideSlug({
    // The alias and its lookup travel together, so `adopt_alias` hands the
    // lookup back and the caller never re-derives it.
    alias: alias && aliasPass ? { slug: alias, payload: aliasPass } : null,
    typedRowExists: precheck !== null,
    aliasBindsSameFile: resolved.aliasBindsSameFile,
    treeListed: resolved.treeListed,
  });
  if (decision.kind === "refuse") {
    return {
      status: "alias_unverifiable",
      source,
      skillId,
      expectedSkillId: decision.expectedSkillId,
      cause: decision.cause,
    };
  }
  const add =
    decision.kind === "adopt_alias"
      ? { skillId: decision.alias, precheck: decision.payload.precheck }
      : { skillId, precheck };

  return {
    status: "ok",
    source,
    skillId: add.skillId,
    path: resolved.path,
    name: resolved.name,
    description: resolved.description,
    // Past terminalFor, a non-null precheck (for whichever slug we settled on)
    // can only be a delisted row.
    wasDelisted: add.precheck !== null,
  };
}

/**
 * A confirm that actually wrote something.
 *
 * Two arms rather than one with `status: "inserted" | "relisted"`, matching the
 * validator: this type is what `FunctionReturnType` hands the client (the
 * handler annotation wins over the validator there), and a union-typed
 * discriminant inside a single arm is not narrowable — the client could not
 * separate a written row from a refusal without a cast.
 */
type GitHubAddSuccess =
  | { status: "inserted"; source: string; skillId: string; name: string }
  | { status: "relisted"; source: string; skillId: string; name: string };

/** Every preview arm except `ok` — what a REFUSAL is, from either step. */
type GitHubPreviewFailure = Exclude<GitHubPreview, { status: "ok" }>;

/**
 * What a confirm returns: a written row, or the re-check's refusal.
 *
 * Named because this is the half of the contract the CLIENT reads — a Convex
 * action's `FunctionReturnType` comes from the handler's return annotation, not
 * from its `returns:` validator. So the three handler signatures below are what
 * `useAddSkillFlow` derives its types from, and spelling the union out at each
 * one meant widening it required finding all three with nothing failing if one
 * was missed. The validator half was already single-sourced (`gitHubAddReturns`).
 */
type GitHubAddResult = GitHubAddSuccess | GitHubPreviewFailure;

/**
 * Insert a skill straight from its GitHub repo, shared by the admin and public
 * confirm actions. Runs the same previewGitHubCore checks server-side rather
 * than trusting the client's preview, then inserts. `opts.addedBy` records the
 * adder (public flow); `opts.enforceGitHubQuotaFor` makes upsertSkillsBatch
 * enforce the free-tier cap atomically with the insert (genuine inserts only —
 * relists consume no quota). Callers own the auth gate.
 *
 * A failed re-check is RETURNED, not thrown: confirm re-runs
 * `previewGitHubCore`, so its refusals are literally preview failures and
 * belong in the same status union the preview returns. Throwing them meant a
 * second prose table server-side (`previewFailureError`, now deleted) that had
 * to be kept in step with `lib/add-skill-copy.ts` by hand — and it wasn't:
 * a review round rewrote one side's wording and missed the twin.
 *
 * Quota and transient failures still THROW, deliberately. The public client's
 * at-limit backstop keys on `isQuotaError(err)` in a catch block, and a
 * rate-limited upstream is not a verdict about this skill the way a preview
 * status is. So the contract is: preview refusals return, everything else
 * throws.
 */
async function addGitHubCore(
  ctx: ActionCtx,
  input: string,
  opts?: {
    addedBy?: Id<"users">;
    enforceGitHubQuotaFor?: { userId: Id<"users">; limit: number };
  },
): Promise<GitHubAddResult> {
  const preview = await previewGitHubCore(ctx, input);
  if (preview.status !== "ok") return preview;
  // The preview owns the slug from here on, not the parse: when the SKILL.md's
  // frontmatter name disagrees with the folder the URL pointed at, it settles
  // on the frontmatter-derived one. Re-deriving it from `input` here would
  // write a row the preview never described.
  const { source: addSource, skillId: addSkillId } = preview;

  await ctx.runMutation(internal.skills.upsertSkillsBatch, {
    skills: [
      {
        source: addSource,
        skillId: addSkillId,
        name: preview.name,
        // No upstream count exists. syncSkills takes over the moment the skill
        // shows up on the leaderboard (the adoption path), and the normal add
        // can adopt it on demand once skills.sh lists it.
        installs: 0,
        isDuplicate: false,
      },
    ],
    leaderboard: GITHUB_LEADERBOARD,
    isGitHubOnly: true,
    // Don't own installs: a FRESH row still seeds the 0 above, but a RELIST
    // (delisted row re-claimed as GitHub-only) keeps its last-known install
    // count instead of being zeroed, and writes no spurious 0-install snapshot.
    ownsInstalls: false,
    ...(opts?.addedBy && { addedBy: opts.addedBy }),
    ...(opts?.enforceGitHubQuotaFor && {
      enforceGitHubQuotaFor: opts.enforceGitHubQuotaFor,
    }),
  });

  // Backfill chain + cache bust + immediate Typesense index — shared with the
  // normal add; see lib/postAdd.ts for the why of each step.
  await kickPostAddChain(ctx, {
    source: addSource,
    skillId: addSkillId,
    description: preview.description,
  });

  return {
    status: preview.wasDelisted ? ("relisted" as const) : ("inserted" as const),
    source: addSource,
    skillId: addSkillId,
    name: preview.name,
  };
}

/**
 * The non-`ok` arms and the `ok` fields, declared once. The admin and public
 * previews return the SAME union apart from `quota`, and nothing type-checks
 * one hand-written copy against the other — a drifted arm surfaces only as a
 * runtime return-validation error in production, so they're composed rather
 * than duplicated.
 */
const previewTerminalArms = [
  v.object({ status: v.literal("not_github") }),
  v.object({ status: v.literal("on_skills_sh") }),
  v.object({
    status: v.literal("on_skills_sh_as_alias"),
    source: v.string(),
    skillId: v.string(),
  }),
  v.object({
    status: v.literal("already_exists"),
    name: v.string(),
    source: v.string(),
    skillId: v.string(),
  }),
  v.object({
    status: v.literal("alias_unverifiable"),
    source: v.string(),
    skillId: v.string(),
    expectedSkillId: v.string(),
    cause: v.union(v.literal("unlisted"), v.literal("conflict")),
  }),
  v.object({ status: v.literal("no_repo") }),
  v.object({ status: v.literal("no_skill_md"), skillId: v.string() }),
  v.object({ status: v.literal("tree_unavailable") }),
] as const;

const previewOkFields = {
  status: v.literal("ok"),
  source: v.string(),
  skillId: v.string(),
  path: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  wasDelisted: v.boolean(),
};

export const previewGitHubSkill = action({
  args: { input: v.string() },
  returns: v.union(...previewTerminalArms, v.object(previewOkFields)),
  handler: async (ctx, { input }): Promise<GitHubPreview> => {
    await assertAdmin(ctx);
    return previewGitHubCore(ctx, input);
  },
});

/** The success payload, spread into both success arms below. */
const gitHubAddSuccessFields = {
  source: v.string(),
  skillId: v.string(),
  name: v.string(),
};

/**
 * Either the confirm wrote something, or it re-checked and refused — and a
 * refusal is one of the same statuses the preview returns, so it reuses
 * `previewTerminalArms` rather than a parallel set of thrown messages.
 *
 * Shared by the admin and public confirm actions, the way `manualAddReturns` is
 * shared by the two manual adds. One const, not two inline copies: the client
 * hook derives its `github_added` outcome from the PUBLIC action's return type
 * and hands it to both surfaces, so a field added to one validator and not the
 * other would break the admin form with a type error pointing at an action it
 * never calls. Sharing the validator makes that divergence impossible rather
 * than merely unlikely.
 *
 * The two success statuses are separate arms rather than one arm with a
 * `v.union` status, so every arm of this union carries exactly one literal.
 * That is what makes it a discriminated union TS can narrow: with a
 * union-typed discriminant in a single arm, neither `status === "inserted" ||
 * status === "relisted"` nor its negation narrows the arm away, and consumers
 * cannot separate a written row from a refusal without a cast.
 */
const gitHubAddReturns = v.union(
  ...previewTerminalArms,
  v.object({ ...gitHubAddSuccessFields, status: v.literal("inserted") }),
  v.object({ ...gitHubAddSuccessFields, status: v.literal("relisted") }),
);

/**
 * Insert a skill straight from its GitHub repo, with no skills.sh presence.
 *
 * Seeds `installs: 0` (nothing upstream to read a count from) and marks the
 * row `isGitHubOnly`, which buys it three things: reconcile skips it instead
 * of burning a detail call that can only 404, the content pipeline stamps
 * `lastSeenInApi` on every successful SKILL.md fetch (the heartbeat — see
 * skills.ts `gitHubOnlyHeartbeat`) so it stays clear of the 30-day delist for
 * exactly as long as GitHub keeps serving the file, and `markStaleContentBatch`
 * exempts it from the discovery-failure cap so transient GitHub trouble can't
 * permanently freeze it.
 *
 * Everything is re-verified server-side rather than trusting the preview:
 * the same three checks run (in parallel, same priority order), so a direct
 * invocation or a preview→confirm race can neither insert a duplicate nor
 * mis-mark a skill that skills.sh actually lists.
 *
 * Discovery is left to the normal pipeline rather than seeding the URL resolved
 * here. Only `source` + `skillId` + name are stored; the file's location is
 * re-derived from the slug afterwards, which handles a repo that moved the file
 * between preview and confirm.
 *
 * The two no longer share a matcher — this path uses `matchesSkillIdExactly`
 * while discovery keeps the loose prefix rule — so "same code, same answer" is
 * NOT the reason they agree. They agree because discovery resolves in three
 * ordered stages: the folder name, then exact names across ALL candidates, then
 * the loose rule over whatever is left. This path only ever binds on one of the
 * first two, so an earlier stage always reaches it. The invariant to preserve if
 * `discoverSkillMdUrls` is refactored is that the exact stage is GLOBAL — an
 * earlier version ran both rules inside one per-file loop, which let a loose hit
 * on an early file beat an exact hit on a later one.
 *
 * Seeding the URL would not remove the need for the alias check either. A 404 on
 * any later content fetch clears `skillMdUrl` and re-flags `needsDiscovery`
 * (skills.ts), so the path gets re-derived from the slug over the row's whole
 * life. A seeded URL defers that, it doesn't own it.
 */
export const addSkillFromGitHub = action({
  args: { input: v.string() },
  returns: gitHubAddReturns,
  handler: async (
    ctx,
    { input },
  ): Promise<GitHubAddResult> => {
    await assertAdmin(ctx);
    return addGitHubCore(ctx, input);
  },
});

// ---------------------------------------------------------------------------
// Slug audit support
//
// The audit itself lives in githubOnlyAudit.ts (see that module for why such a
// row can exist and why it is only ever reported, never repaired). Only its
// list query is here, so the DB read and the fetch loop sit either side of the
// query/action boundary they actually straddle, and so this file keeps its
// stated scope (resolver + preview + confirm) plus one small support query.
//
// It buys nothing type-wise: the audit still declares its row and result types
// by hand, because the generated `internal` object is ONE type spanning every
// module, so a function that both reads `internal.*` and is reachable through
// it is self-referential wherever it lives. See githubOnlyAudit.ts's header.
// ---------------------------------------------------------------------------

/**
 * GitHub-only rows, slim enough to hand to an action, newest first.
 *
 * Reads `skillSummaries`, not `skills`: every field the audit needs is
 * mirrored there (`skillMdUrl` in lockstep via `updateSkillMdUrls`,
 * `isGitHubOnly` at insert and on adoption) at ~200 B/row instead of the
 * ~13-25 KB a `skills` document costs, which `content` dominates.
 *
 * Paginated, so the audit can walk the WHOLE population rather than a fixed
 * window. `cursor` is the caller's to hold — the admin card passes the last one
 * back to continue — so nothing has to persist audit progress anywhere. `limit`
 * is the caller's fetch budget, and it is what bounds a page: the DB read is the
 * cheap half (`embeddingCoverageStatsBatch` in skills.ts pages this same table
 * 1000 at a time, ≈200 KB against a 16 MB budget), while every row returned
 * costs the audit a GitHub fetch inside an action that has a time limit. So the
 * binding constraint is the fetch loop, not the read.
 *
 * Cursor-nullable rather than the `{ nextCursor, isDone }` shape its sibling
 * paginated readers use: the two facts are one fact here (null MEANS done), and
 * a caller cannot then pass a cursor that doesn't advance. Not `v.optional` on
 * top of that — three states for a two-state concept, and no caller omits it.
 *
 * `.order("desc")` puts the newest rows first so the first page covers what a
 * partial audit most wants to see. Note the ordering argument is about which
 * end you reach first, NOT that old rows are likelier to be fine — they aren't,
 * since the legacy mis-slugged population is precisely the oldest rows.
 */
export const listGitHubOnlyRows = internalQuery({
  args: { limit: v.number(), cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    rows: v.array(
      v.object({
        source: v.string(),
        skillId: v.string(),
        name: v.string(),
        isDelisted: v.boolean(),
        skillMdUrl: v.optional(v.string()),
      }),
    ),
    /** Pass back as `cursor` to continue. Null when this page is the last. */
    cursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { limit, cursor }) => {
    const page = await ctx.db
      .query("skillSummaries")
      .withIndex("by_isGitHubOnly", (q) => q.eq("isGitHubOnly", true))
      .order("desc")
      .paginate({ numItems: limit, cursor });
    return {
      rows: page.page.map((r) => ({
        source: r.source,
        skillId: r.skillId,
        name: r.name,
        isDelisted: r.isDelisted,
        // Empty string means discovery ran and found nothing — same as absent
        // for our purposes, so normalise it away.
        ...(r.skillMdUrl ? { skillMdUrl: r.skillMdUrl } : {}),
      })),
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});

// ---------------------------------------------------------------------------
// Public add flow (Branch 2 — the GitHub-only fallback)
//
// Branch 1 (a skill that IS on skills.sh) is skills.addSkillManuallyPublic;
// the client tries that first and falls through here on `not_on_skills_sh`.
// Both actions gate on auth by calling skills.getGitHubAddQuota, which throws
// a clean ConvexError when signed out, and both count against the shared
// per-user add-flow throttle (throttle.ts) — repo resolution is dozens of
// GitHub calls against the pipeline's shared token budget, so it can't be
// free-for-all even though only this branch is quota-limited.
// ---------------------------------------------------------------------------

const PUBLIC_ADD_FALLBACK_ERROR =
  "Something went wrong talking to GitHub or skills.sh. Try again in a minute.";

type GitHubPreviewPublic =
  | GitHubPreviewFailure
  | (Extract<GitHubPreview, { status: "ok" }> & {
      quota: GitHubAddQuotaStatus;
    });

/**
 * Public preview: resolves the repo AND returns the caller's GitHub-only-add
 * quota on the `ok` branch, so the flow can show "N of M used" and swap the
 * confirm button for an upgrade prompt when the user is already at the cap.
 * Not short-circuited at the cap: `wasDelisted` previews must stay reachable
 * (relists consume no quota), and the throttle bounds the resolution cost.
 */
export const previewGitHubSkillPublic = action({
  args: { input: v.string() },
  returns: v.union(
    ...previewTerminalArms,
    v.object({ ...previewOkFields, quota: gitHubQuotaValidator }),
  ),
  handler: async (ctx, { input }): Promise<GitHubPreviewPublic> => {
    // Doubles as the auth gate: getGitHubAddQuota throws if not signed in.
    const quota = await ctx.runQuery(internal.skills.getGitHubAddQuota, {});
    await ctx.runMutation(internal.throttle.bumpAddSkillThrottle, {
      userId: quota.userId,
    });
    try {
      const preview = await previewGitHubCore(ctx, input);
      if (preview.status === "ok") {
        return {
          ...preview,
          quota: {
            plan: quota.plan,
            used: quota.used,
            limit: quota.limit,
            atLimit: quota.atLimit,
          },
        };
      }
      return preview;
    } catch (err) {
      throw toPublicError(err, PUBLIC_ADD_FALLBACK_ERROR);
    }
  },
});

/**
 * Public confirm: attributes the add and enforces the free-tier cap
 * atomically inside upsertSkillsBatch (enforceGitHubQuotaFor) — and only on
 * the genuine-insert branch, so an at-limit user can still relist a delisted
 * row (no quota consumed there). No action-level atLimit pre-throw for the
 * same reason; the UI gates the genuine-insert case and the throttle bounds
 * the resolution cost of anything that slips past it.
 */
export const addSkillFromGitHubPublic = action({
  args: { input: v.string() },
  returns: gitHubAddReturns,
  handler: async (
    ctx,
    { input },
  ): Promise<GitHubAddResult> => {
    const quota = await ctx.runQuery(internal.skills.getGitHubAddQuota, {});
    await ctx.runMutation(internal.throttle.bumpAddSkillThrottle, {
      userId: quota.userId,
    });
    try {
      return await addGitHubCore(ctx, input, {
        addedBy: quota.userId,
        // Only free users (finite limit) get the atomic gate; Pro is null.
        ...(quota.limit !== null && {
          enforceGitHubQuotaFor: { userId: quota.userId, limit: quota.limit },
        }),
      });
    } catch (err) {
      throw toPublicError(err, PUBLIC_ADD_FALLBACK_ERROR);
    }
  },
});
