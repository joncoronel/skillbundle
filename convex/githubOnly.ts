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
import { action } from "./_generated/server";
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
import { kebabCase, matchesSkillId } from "./lib/skillMatch";
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
  ): GitHubSkillResolution => {
    const fmName = extractSkillMdName(contents);
    return {
      status: "ok",
      skillMdUrl: rawUrl(branch, path),
      path,
      name: fmName ?? humanizeSlug(skillId),
      ...(fmName && { fmName }),
      description: extractFrontmatterDescription(contents) ?? undefined,
    };
  };

  // Network-level throws (DNS, reset) are treated like a non-ok response
  // everywhere in this resolver: the fetch reports null and the caller
  // decides, instead of the throw escaping as a redacted "Server Error".
  const fetchText = async (url: string): Promise<string | null> => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
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
      if (path !== "SKILL.md") return okResult(meta.defaultBranch, path, contents);
      const fmName = extractSkillMdName(contents);
      if (fmName && matchesSkillId(fmName, skillId)) {
        return okResult(meta.defaultBranch, path, contents);
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
    if (contents !== null) return okResult(tree.branch, dirMatch, contents);
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
        return okResult(tree.branch, wave[j], contents);
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
  // `retryInput` is set only when the listing was found under a DIFFERENT slug
  // than the caller typed (the frontmatter-name alias below). It's the exact
  // input string that would succeed, so the client can re-run the normal add
  // instead of telling the user to retry something that just failed.
  | { status: "on_skills_sh"; retryInput?: string }
  // source/skillId identify the row that already exists — which is not
  // necessarily the slug the caller typed, so the UI can link to the real one.
  | { status: "already_exists"; name: string; source: string; skillId: string }
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
  if (precheck && !precheck.isDelisted) {
    return {
      status: "already_exists",
      name: precheck.name,
      source,
      skillId,
    };
  }
  // If skills.sh does know the skill, the ordinary manual add is the right
  // path — it yields a real install count and a normal lifecycle.
  if (unwrap(listingR) === "listed") return { status: "on_skills_sh" };

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
  // "not on skills.sh" for a listed skill, and confirming it inserts a
  // duplicate row under the folder slug — one that reconcile skips and that
  // the adoption path (which matches on source+skillId) can never claim.
  //
  // Only runs on a genuine mismatch, so the common case pays nothing. It is
  // deliberately AFTER the folder-slug checks: the slug the user typed wins
  // when it resolves to something real.
  const alias = resolved.fmName ? kebabCase(resolved.fmName) : null;
  let addSkillId = skillId;
  let addPrecheck = precheck;
  if (alias && alias !== skillId) {
    const [aliasPrecheckR, aliasListingR] = await Promise.allSettled([
      ctx.runQuery(internal.skills.getManualAddPrecheck, {
        source,
        skillId: alias,
      }) as Promise<Precheck>,
      checkSkillsShListing(source, alias),
    ]);
    const aliasPrecheck = unwrap(aliasPrecheckR);
    if (aliasPrecheck && !aliasPrecheck.isDelisted) {
      return {
        status: "already_exists",
        name: aliasPrecheck.name,
        source,
        skillId: alias,
      };
    }
    if (unwrap(aliasListingR) === "listed") {
      return { status: "on_skills_sh", retryInput: `${source}/${alias}` };
    }
    // Genuinely GitHub-only. Insert under the frontmatter-derived slug — the
    // one skills.sh would assign if it ever lists the skill — so adoption can
    // match it later instead of stranding a folder-slugged row beside it.
    addSkillId = alias;
    addPrecheck = aliasPrecheck;
  }

  return {
    status: "ok",
    source,
    skillId: addSkillId,
    path: resolved.path,
    name: resolved.name,
    description: resolved.description,
    // Past the already_exists checks, a non-null precheck (for whichever slug
    // we settled on) can only be a delisted row.
    wasDelisted: addPrecheck !== null,
  };
}

/**
 * One home for translating a failed preview status into the user-facing
 * ConvexError the confirm path throws. Kept beside previewGitHubCore so the
 * check logic and its failure copy can't drift between preview and confirm.
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
        preview.retryInput
          ? `That SKILL.md is listed on skills.sh as "${preview.retryInput}" (its frontmatter name, not its folder name). Add it with that and it comes in the normal way.`
          : `${source}/${skillId} is listed on skills.sh. Run the add again to bring it in the normal way.`,
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

export const previewGitHubSkill = action({
  args: { input: v.string() },
  returns: v.union(
    v.object({ status: v.literal("not_github") }),
    v.object({
      status: v.literal("on_skills_sh"),
      retryInput: v.optional(v.string()),
    }),
    v.object({
      status: v.literal("already_exists"),
      name: v.string(),
      source: v.string(),
      skillId: v.string(),
    }),
    v.object({ status: v.literal("no_repo") }),
    v.object({ status: v.literal("no_skill_md") }),
    v.object({ status: v.literal("tree_unavailable") }),
    v.object({
      status: v.literal("ok"),
      source: v.string(),
      skillId: v.string(),
      path: v.string(),
      name: v.string(),
      description: v.optional(v.string()),
      wasDelisted: v.boolean(),
    }),
  ),
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
export const addSkillFromGitHub = action({
  args: { input: v.string() },
  returns: v.object({
    status: v.union(v.literal("inserted"), v.literal("relisted")),
    source: v.string(),
    skillId: v.string(),
    name: v.string(),
  }),
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
    v.object({ status: v.literal("not_github") }),
    v.object({
      status: v.literal("on_skills_sh"),
      retryInput: v.optional(v.string()),
    }),
    v.object({
      status: v.literal("already_exists"),
      name: v.string(),
      source: v.string(),
      skillId: v.string(),
    }),
    v.object({ status: v.literal("no_repo") }),
    v.object({ status: v.literal("no_skill_md") }),
    v.object({ status: v.literal("tree_unavailable") }),
    v.object({
      status: v.literal("ok"),
      source: v.string(),
      skillId: v.string(),
      path: v.string(),
      name: v.string(),
      description: v.optional(v.string()),
      wasDelisted: v.boolean(),
      quota: gitHubQuotaValidator,
    }),
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
  returns: v.object({
    status: v.union(v.literal("inserted"), v.literal("relisted")),
    source: v.string(),
    skillId: v.string(),
    name: v.string(),
  }),
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
