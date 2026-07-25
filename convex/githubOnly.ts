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
  NOT_MODIFIED,
} from "./lib/github";
import {
  getSkillDetail as v1GetSkillDetail,
  SkillsApiNotFoundError,
  SkillsApiRateLimitError,
  withTransientRetry,
} from "./lib/skillsApi";
import { canonicalSlug, matchesSkillId } from "./lib/skillMatch";
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

/**
 * Bound on how many SKILL.md candidates pass 2 will download. This runs
 * inside a user-facing action (the admin is watching a spinner), so a skills
 * monorepo with hundreds of SKILL.md files must not turn preview into a
 * multi-minute stall. Anything past the cap is treated as not-found — the
 * direct-path probes and pass 1 cover the conventional layouts regardless.
 */
const RESOLVE_PASS2_CAP = 50;

/**
 * Pass-2 downloads run in concurrent waves of this size (with early exit on
 * the first match) instead of strictly serially — worst case drops from ~50
 * sequential round-trips behind a spinner to ~5 waves.
 */
const PASS2_WAVE_SIZE = 10;

// ---------------------------------------------------------------------------
// Shared plumbing (used by both preview and confirm — one pipeline, two
// terminal mappings)
// ---------------------------------------------------------------------------

/** parseSkillInput with its plain Error wrapped so prod preserves the message. */
function parseAdminInput(input: string): { source: string; skillId: string } {
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
  source: string,
  skillId: string,
): Promise<"listed" | "not_listed"> {
  try {
    await withTransientRetry(() => v1GetSkillDetail(source, skillId));
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
      // means the loose `matchesSkillId` rule bound it, which includes a bare
      // `startsWith` prefix hit (slug "next" matching "Next JS Development").
      // previewGitHubCore only trusts the frontmatter name as a slug on the
      // `"dir"` path, so a prefix guess can never drive a write.
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
 * Network-level throws (DNS, reset) are treated like a non-ok response
 * everywhere in the resolver: the fetch reports null and the caller decides,
 * instead of the throw escaping as a redacted "Server Error".
 *
 * Module scope rather than a closure — it captures nothing, so nesting it only
 * meant the rule could be restated. The audit (githubOnlyAudit.ts) needs
 * stricter semantics than this (host pinning, a 404 split, a retry) and has its
 * own; that difference is deliberate, not drift.
 */
async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Locate one skill's SKILL.md inside a GitHub repo, writing nothing.
 *
 * Matching goes through the shared `matchesSkillId` (lib/skillMatch.ts) — the
 * same rule the post-insert discovery pipeline uses — so the file the admin
 * confirms in the preview is the file discovery binds after insert. This
 * function exists separately because discovery is batch-oriented and writes
 * straight to the DB, whereas this must report a result before any row
 * exists. When the tree is unavailable it mirrors discovery's fallback and
 * probes the conventional paths directly.
 */
async function resolveGitHubSkillMd(
  source: string,
  skillId: string,
): Promise<GitHubSkillResolution> {
  const [owner, repo] = source.split("/");
  const meta = await fetchRepoMetadata(owner, repo);
  // NOTE: fetchRepoMetadata cannot distinguish 404 from a rate limit (both
  // return null), so the caller's message for no_repo hedges accordingly.
  if (!meta) return { status: "no_repo" };

  const rawUrl = (branch: string, path: string) =>
    `https://raw.githubusercontent.com/${source}/${branch}/${path}`;

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

  const tree = await fetchRepoTree(owner, repo, [meta.defaultBranch]);
  // Tree unavailable (too large / rate limited / transient) or truncated:
  // don't claim absence — fall back to probing the conventional layouts
  // directly, the same escape hatch discoverSkillMdUrls uses. All three
  // probes run concurrently; results are evaluated in priority order.
  if (!tree || tree === NOT_MODIFIED || tree.truncated) {
    const probePaths = [
      `skills/${skillId}/SKILL.md`,
      `.claude/skills/${skillId}/SKILL.md`,
      "SKILL.md",
    ];
    const bodies = await Promise.all(
      probePaths.map((path) => fetchText(rawUrl(meta.defaultBranch, path))),
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
      if (fmName && matchesSkillId(fmName, skillId)) {
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

  const candidates: string[] = [];
  const byDir = new Map<string, string>();
  for (const entry of tree.entries) {
    if (entry.type !== "blob") continue;
    const lower = entry.path.toLowerCase();
    if (lower !== "skill.md" && !lower.endsWith("/skill.md")) continue;
    candidates.push(entry.path);
    const parts = entry.path.split("/");
    if (parts.length >= 2) byDir.set(parts[parts.length - 2], entry.path);
  }
  if (candidates.length === 0) return { status: "no_skill_md" };

  // Pass 1: a directory named exactly like the slug. Fetch it once here — its
  // contents are needed for the name/description either way.
  const dirMatch = byDir.get(skillId);
  if (dirMatch) {
    const contents = await fetchText(rawUrl(tree.branch, dirMatch));
    if (contents !== null) {
      return okResult(tree.branch, dirMatch, contents, "dir", byDir);
    }
    // The tree said the file exists but raw serves an error — transient CDN
    // trouble, not proof of absence.
    return { status: "tree_unavailable" };
  }

  // Pass 2: frontmatter `name` via the shared matcher. Covers a root-level
  // SKILL.md (no parent dir to match on) and repos whose folder names don't
  // line up with the slug. Downloads run in concurrent waves; within a wave,
  // results are checked in candidate order so first-match-wins semantics are
  // identical to a serial scan.
  const capped = candidates.slice(0, RESOLVE_PASS2_CAP);
  for (let i = 0; i < capped.length; i += PASS2_WAVE_SIZE) {
    const wave = capped.slice(i, i + PASS2_WAVE_SIZE);
    const bodies = await Promise.all(
      wave.map((path) => fetchText(rawUrl(tree.branch, path))),
    );
    for (let j = 0; j < wave.length; j++) {
      const contents = bodies[j];
      if (contents === null) continue;
      const fmName = extractSkillMdName(contents);
      if (fmName && matchesSkillId(fmName, skillId)) {
        return okResult(tree.branch, wave[j], contents, "frontmatter", byDir);
      }
    }
  }
  return { status: "no_skill_md" };
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
  | { status: "no_skill_md" }
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
  source: string,
  alias: string,
): Promise<{ precheck: Precheck; terminal: GitHubPreview | null }> {
  const [precheckR, listingR] = await Promise.allSettled([
    ctx.runQuery(internal.skills.getManualAddPrecheck, {
      source,
      skillId: alias,
    }) as Promise<Precheck>,
    checkSkillsShListing(source, alias),
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
  const { source, skillId } = parseAdminInput(input);

  // Well-known sources have no repo to read a SKILL.md out of.
  if (!isGitHubSource(source)) return { status: "not_github" };

  const [precheckR, listingR, resolvedR] = await Promise.allSettled([
    ctx.runQuery(internal.skills.getManualAddPrecheck, {
      source,
      skillId,
    }) as Promise<Precheck>,
    checkSkillsShListing(source, skillId),
    resolveGitHubSkillMd(source, skillId),
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
  // Restricted to `matchedBy === "dir"`: only there did the caller point at
  // this exact folder, so its frontmatter name is a statement about the skill
  // they meant. A `"frontmatter"` match can come from the loose `startsWith`
  // rule, and letting a prefix guess name the skill would put a slug the user
  // never typed on the end of a write with no confirmation step.
  //
  // Runs only on a genuine mismatch, and deliberately AFTER the typed-slug
  // checks: the slug the caller gave wins whenever it resolves to something.
  const alias = aliasCandidate({
    typedSkillId: skillId,
    canonicalFmName: resolved.fmName ? canonicalSlug(resolved.fmName) : null,
    matchedBy: resolved.matchedBy,
  });
  const aliasPass = alias ? await checkAliasSlug(ctx, source, alias) : null;
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
 * One home for translating a failed preview status into the user-facing
 * ConvexError the confirm path throws. Kept beside previewGitHubCore so the
 * check logic and its failure copy can't drift between preview and confirm.
 *
 * NOTE: this is the SECOND prose table over the same status union — the client
 * has `previewFailureCopy` (lib/add-skill-copy.ts) for the returned statuses.
 * A new status needs an arm in both. It exists only because confirm THROWS
 * where preview returns; having confirm return a `PreviewFailure` instead would
 * delete this whole function. See TODO.md.
 */
function previewFailureError(
  preview: Exclude<GitHubPreview, { status: "ok" }>,
  source: string,
  skillId: string,
): ConvexError<string> {
  switch (preview.status) {
    case "not_github":
      return new ConvexError(
        `"${source}" isn't a GitHub source. Only GitHub repos can be added without a skills.sh listing.`,
      );
    case "already_exists":
      return new ConvexError(`${preview.name} is already in the catalog.`);
    // Re-verified at confirm time — not just the repo. Without this, a LISTED
    // skill could be inserted as GitHub-only with installs 0, and since
    // reconcile skips GitHub-only rows, a skill absent from the leaderboard
    // feed would then only recover via the manual adoption path.
    case "on_skills_sh":
      return new ConvexError(
        `${source}/${skillId} is listed on skills.sh. Run the add again to bring it in the normal way.`,
      );
    case "on_skills_sh_as_alias":
      return new ConvexError(
        `That SKILL.md is listed on skills.sh as "${preview.source}/${preview.skillId}" — its frontmatter name, not the folder name in the link. Add it with that and it comes in the normal way.`,
      );
    case "alias_unverifiable":
      return new ConvexError(
        preview.cause === "unlisted"
          ? // Hedged deliberately: "unlisted" is either a rate limit or a tree
            // too large to list, and fetchRepoTree can't tell us which.
            `That SKILL.md is named "${preview.expectedSkillId}", but GitHub wouldn't list ${preview.source}'s files (rate-limited, or the repo is too large to list), so we couldn't confirm it's safe to store it under that name. Adding it as "${preview.skillId}" instead would leave a row skills.sh can never adopt, so nothing was written. Worth retrying shortly; if it keeps failing, add it once skills.sh lists it.`
          : `That SKILL.md is named "${preview.expectedSkillId}", but ${preview.source} already has a different SKILL.md in a folder of that name, so storing it correctly would bind the wrong file. Nothing was written. This one needs the repo fixed, or add it once skills.sh lists it.`,
      );
    case "no_repo":
      // fetchRepoMetadata can't distinguish 404 from a GitHub rate limit, so
      // don't claim certainty.
      return new ConvexError(
        `Couldn't find a public GitHub repo at "${source}" (or GitHub rate-limited the lookup). Try again in a minute.`,
      );
    case "tree_unavailable":
      return new ConvexError(
        `Couldn't list the files in ${source} (repo too large or GitHub rate-limited). The conventional SKILL.md paths were probed directly with no match. Try again shortly.`,
      );
    case "no_skill_md":
      return new ConvexError(
        `No SKILL.md for "${skillId}" in ${source} (matched by folder name and frontmatter name). Check the slug.`,
      );
  }
}

/**
 * Insert a skill straight from its GitHub repo, shared by the admin and public
 * confirm actions. Runs the same previewGitHubCore checks server-side rather
 * than trusting the client's preview, then inserts. `opts.addedBy` records the
 * adder (public flow); `opts.enforceGitHubQuotaFor` makes upsertSkillsBatch
 * enforce the free-tier cap atomically with the insert (genuine inserts only —
 * relists consume no quota). Callers own the auth gate.
 */
async function addGitHubCore(
  ctx: ActionCtx,
  input: string,
  opts?: {
    addedBy?: Id<"users">;
    enforceGitHubQuotaFor?: { userId: Id<"users">; limit: number };
  },
): Promise<{
  status: "inserted" | "relisted";
  source: string;
  skillId: string;
  name: string;
}> {
  const { source, skillId } = parseAdminInput(input);

  const preview = await previewGitHubCore(ctx, input);
  if (preview.status !== "ok") {
    throw previewFailureError(preview, source, skillId);
  }
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
  v.object({ status: v.literal("no_skill_md") }),
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
 * Discovery is left to the normal pipeline rather than seeding the URL
 * resolved here: it re-derives the same path with fully-exercised code (same
 * shared matcher), and correctly handles a repo that moved the file between
 * preview and confirm.
 */
/**
 * Shared by the admin and public confirm actions, the way `manualAddReturns`
 * is shared by the two manual adds.
 *
 * One const, not two inline copies: the client hook derives its `github_added`
 * outcome from the PUBLIC action's return type and hands it to both surfaces,
 * so a field added to one validator and not the other would break the admin
 * form with a type error pointing at an action it never calls. Sharing the
 * validator makes that divergence impossible rather than merely unlikely.
 */
const gitHubAddReturns = v.object({
  status: v.union(v.literal("inserted"), v.literal("relisted")),
  source: v.string(),
  skillId: v.string(),
  name: v.string(),
});

export const addSkillFromGitHub = action({
  args: { input: v.string() },
  returns: gitHubAddReturns,
  handler: async (
    ctx,
    { input },
  ): Promise<{
    status: "inserted" | "relisted";
    source: string;
    skillId: string;
    name: string;
  }> => {
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
 * mirrored there (`skillMdUrl` in lockstep via `updateSkillMdUrl`,
 * `isGitHubOnly` at insert and on adoption) at ~200 B/row instead of the
 * ~13-25 KB a `skills` document costs, which `content` dominates. `limit` is
 * required rather than optional so the caller's fetch budget and this read are
 * governed by one number — an unbounded `.collect()` here would blow the
 * transaction read limit at a row count far below the fetch cap, i.e. it would
 * start failing exactly when the population became worth auditing.
 *
 * `.order("desc")` is load-bearing, not cosmetic. An index walk is
 * deterministically ordered, so a capped ascending read returns the SAME oldest
 * rows on every run and everything added past the cap would never be audited —
 * not "later", never — while the rows the audit exists for are the newest ones
 * (a mismatch can still arrive via the loose prefix arm). Newest-first means a
 * capped run covers the interesting end. Paging the whole population across
 * runs is the real answer if it ever outgrows one read; see TODO.md.
 */
export const listGitHubOnlyRows = internalQuery({
  args: { limit: v.number() },
  returns: v.array(
    v.object({
      source: v.string(),
      skillId: v.string(),
      name: v.string(),
      isDelisted: v.boolean(),
      skillMdUrl: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("skillSummaries")
      .withIndex("by_isGitHubOnly", (q) => q.eq("isGitHubOnly", true))
      .order("desc")
      .take(limit);
    return rows.map((r) => ({
      source: r.source,
      skillId: r.skillId,
      name: r.name,
      isDelisted: r.isDelisted,
      // Empty string means discovery ran and found nothing — same as absent
      // for our purposes, so normalise it away.
      ...(r.skillMdUrl ? { skillMdUrl: r.skillMdUrl } : {}),
    }));
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
  | Exclude<GitHubPreview, { status: "ok" }>
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
  ): Promise<{
    status: "inserted" | "relisted";
    source: string;
    skillId: string;
    name: string;
  }> => {
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
