// ---------------------------------------------------------------------------
// Duplicate / rename detection (Phase 2)
// ---------------------------------------------------------------------------
//
// Two relationships, two signals:
//   - ALIASES (same repo, renamed): resolve each GitHub source to its stable
//     repo id via the API (a renamed repo 301-redirects to its live name, same
//     id). Summaries sharing a githubRepoId + slug under different `source`
//     names are aliases of one repo; the live one is the source matching
//     `repoLiveName`.
//   - FORKS (different repos, same content): summaries sharing a syncHash across
//     DIFFERENT repo ids.
//
// resolveRepoIdentities backfills githubRepoId + repoLiveName onto summaries
// (cached per-repo so we call GitHub once per repo, not once per skill).
// getSkillCopies reads the relationships at request time via two indexed lookups.

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type QueryCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { isGitHubSource } from "./lib/source";
import { resolveRepoIdentity } from "./lib/github";

// Sentinel stamped on a GitHub summary whose repo couldn't be resolved (404 /
// deleted / private). Marks it "resolved, no id" so the scan doesn't keep
// retrying it, and getSkillCopies treats it as having no aliases.
const REPO_ID_NONE = -1;

// Summaries scanned per invocation. Small so the GitHub calls for cache-misses
// in one batch stay well under the rate limit; the job self-schedules the rest.
const RESOLVE_PAGE = 100;
const RESOLVE_MAX_ITER = 400; // backstop (≈ full non-delisted set / page)
// Cap how many rows getSkillCopies returns per group — copies are few, but a
// shared hash could in theory match many; bound the read.
const COPIES_LIMIT = 25;
// Counting cap for the denormalized copyCount (computeCopyCountBatch). The chip
// renders "9+" past ~10, so this only needs a safe ceiling.
const COPYCOUNT_GROUP_CAP = 100;

// ---------------------------------------------------------------------------
// Copy grouping — the single source of truth for "who shares this content"
// ---------------------------------------------------------------------------
//
// Aliases and forks get consumed three ways (the list copyCount, the detail
// read, the delist decrement). These two helpers are the ONE place the rule
// lives, so those call sites can't drift apart. Each returns the live
// (non-delisted) peer rows; callers count / project / patch them, and pass their
// own `cap` (UI list limit vs. count ceiling vs. decrement cap).

/** Fields the grouping rule needs from a summary (a Doc satisfies this). */
type CopyGroupSubject = Pick<
  Doc<"skillSummaries">,
  "source" | "skillId" | "githubRepoId" | "syncHash"
>;

/**
 * Aliases: the same GitHub repo (stable id) + slug under a different source — a
 * rename. No real repo id (undefined / sentinel) → no aliases.
 */
export async function aliasPeers(
  ctx: QueryCtx,
  subject: CopyGroupSubject,
  cap: number,
): Promise<Doc<"skillSummaries">[]> {
  const repoId = subject.githubRepoId;
  if (repoId === undefined || repoId === REPO_ID_NONE) return [];
  const rows = await ctx.db
    .query("skillSummaries")
    .withIndex("by_repo_skill", (q) =>
      q.eq("githubRepoId", repoId).eq("skillId", subject.skillId),
    )
    .take(cap + 1);
  return rows.filter((r) => r.source !== subject.source && !r.isDelisted);
}

/**
 * Forks: the same content hash under a different REAL repo id — separate repos
 * with identical SKILL.md.
 *
 * `githubRepoId === undefined` means two different things, so we disambiguate up
 * front rather than letting `!== repoId` paper over it:
 *   - a well-known / non-GitHub source has NO repo id, ever — fork-matching by
 *     hash is correct (a genuine cross-repo content match);
 *   - an unresolved GitHub row has no repo id *yet* — fork-matching would falsely
 *     count every resolved hash peer as a fork, so we return nothing and wait for
 *     resolveRepoIdentities to stamp it.
 * Because list / detail all call this, they agree by construction.
 */
export async function forkPeers(
  ctx: QueryCtx,
  subject: CopyGroupSubject,
  cap: number,
): Promise<Doc<"skillSummaries">[]> {
  const hash = subject.syncHash;
  if (!hash) return [];
  const repoId = subject.githubRepoId;
  // Unresolved GitHub row: can't be fork-classified until it has a repo id.
  if (repoId === undefined && isGitHubSource(subject.source)) return [];
  const rows = await ctx.db
    .query("skillSummaries")
    .withIndex("by_syncHash", (q) => q.eq("syncHash", hash))
    .take(cap * 2 + 1);
  return rows.filter(
    (r) =>
      r.source !== subject.source &&
      !r.isDelisted &&
      r.githubRepoId !== undefined &&
      r.githubRepoId !== REPO_ID_NONE &&
      r.githubRepoId !== repoId,
  );
}

// ---------------------------------------------------------------------------
// Resolution job
// ---------------------------------------------------------------------------

// Load cached resolutions for a specific set of repos (the current page's
// distinct sources), not the whole table. Bounds each resolve iteration's cache
// read to O(page) instead of O(table) while preserving cross-iteration dedup: a
// repo resolved on an earlier page is persisted, so its by_repo lookup hits here
// on a later page and we don't re-hit GitHub for it.
export const getResolutionsForRepos = internalQuery({
  args: { repos: v.array(v.string()) },
  handler: async (ctx, { repos }) => {
    const out: { repo: string; repoId: number | null; liveName: string | null }[] = [];
    for (const repo of repos) {
      const row = await ctx.db
        .query("githubRepoResolution")
        .withIndex("by_repo", (q) => q.eq("repo", repo))
        .unique();
      if (row) out.push({ repo: row.repo, repoId: row.repoId, liveName: row.liveName });
    }
    return out;
  },
});

export const listSummariesToResolve = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    // Non-delisted only; the unstamped GitHub ones are the work.
    const result = await ctx.db
      .query("skillSummaries")
      .withIndex("by_isDelisted", (q) => q.lt("isDelisted", true))
      .paginate(
        cursor ? { numItems: RESOLVE_PAGE, cursor } : { numItems: RESOLVE_PAGE, cursor: null },
      );
    const items = result.page
      .filter((s) => s.githubRepoId === undefined && isGitHubSource(s.source))
      .map((s) => ({ summaryId: s._id, source: s.source }));
    return { items, nextCursor: result.continueCursor, isDone: result.isDone };
  },
});

export const applyResolutions = internalMutation({
  args: {
    cacheRows: v.array(
      v.object({
        repo: v.string(),
        repoId: v.union(v.number(), v.null()),
        liveName: v.union(v.string(), v.null()),
      }),
    ),
    stamps: v.array(
      v.object({
        summaryId: v.id("skillSummaries"),
        githubRepoId: v.number(),
        repoLiveName: v.string(),
      }),
    ),
  },
  handler: async (ctx, { cacheRows, stamps }) => {
    const now = Date.now();
    for (const row of cacheRows) {
      const existing = await ctx.db
        .query("githubRepoResolution")
        .withIndex("by_repo", (q) => q.eq("repo", row.repo))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, {
          repoId: row.repoId,
          liveName: row.liveName,
          resolvedAt: now,
        });
      } else {
        await ctx.db.insert("githubRepoResolution", { ...row, resolvedAt: now });
      }
    }
    for (const s of stamps) {
      await ctx.db.patch(s.summaryId, {
        githubRepoId: s.githubRepoId,
        repoLiveName: s.repoLiveName,
      });
    }
  },
});

export const resolveRepoIdentities = internalAction({
  args: { cursor: v.optional(v.string()), iteration: v.optional(v.number()) },
  // Explicit annotation — runQuery/runMutation into internal.* otherwise pulls
  // the whole api type into an inference cycle.
  handler: async (
    ctx,
    args,
  ): Promise<{ stamped: number; resolvedRepos: number; done: boolean }> => {
    const iteration = args.iteration ?? 0;

    const page = await ctx.runQuery(internal.duplicates.listSummariesToResolve, {
      cursor: args.cursor,
    });

    // Per-invocation in-memory cache, keyed by "owner/repo". Seed it with only
    // THIS page's distinct repos (not the whole resolution table): a repo
    // resolved on an earlier page is persisted, so its lookup here hits and we
    // skip a redundant GitHub call. Repos resolved within this page are added as
    // we go. Keeps the per-iteration cache read O(page), not O(table).
    const cache = new Map<string, { repoId: number | null; liveName: string | null }>();
    const distinctRepos = [...new Set(page.items.map((i) => i.source))];
    if (distinctRepos.length > 0) {
      const persisted = await ctx.runQuery(internal.duplicates.getResolutionsForRepos, {
        repos: distinctRepos,
      });
      for (const r of persisted) cache.set(r.repo, { repoId: r.repoId, liveName: r.liveName });
    }

    const cacheRows: { repo: string; repoId: number | null; liveName: string | null }[] = [];
    const stamps: { summaryId: typeof page.items[number]["summaryId"]; githubRepoId: number; repoLiveName: string }[] = [];
    let resolvedRepos = 0;

    for (const item of page.items) {
      const repo = item.source;
      let resolved = cache.get(repo);

      if (resolved === undefined) {
        const r = await resolveRepoIdentity(repo);
        if (r.status === "rate_limited") {
          // Pace against GitHub's limit: flush what we have, resume in 60s.
          if (cacheRows.length > 0 || stamps.length > 0) {
            await ctx.runMutation(internal.duplicates.applyResolutions, { cacheRows, stamps });
          }
          await ctx.scheduler.runAfter(60_000, internal.duplicates.resolveRepoIdentities, {
            cursor: args.cursor,
            iteration: iteration + 1,
          });
          return { stamped: stamps.length, resolvedRepos, done: false };
        }
        if (r.status === "error") {
          // Transient — don't cache, leave unstamped, retry on the next run.
          continue;
        }
        resolved = r.status === "ok"
          ? { repoId: r.repoId, liveName: r.liveName }
          : { repoId: null, liveName: null }; // not_found
        cache.set(repo, resolved);
        cacheRows.push({ repo, ...resolved });
        resolvedRepos++;
      }

      // Stamp the summary. Resolved repo → its id + live name; unresolvable
      // (404) → the sentinel so it's excluded from future scans.
      if (resolved.repoId !== null && resolved.liveName !== null) {
        stamps.push({ summaryId: item.summaryId, githubRepoId: resolved.repoId, repoLiveName: resolved.liveName });
      } else {
        stamps.push({ summaryId: item.summaryId, githubRepoId: REPO_ID_NONE, repoLiveName: "" });
      }
    }

    if (cacheRows.length > 0 || stamps.length > 0) {
      await ctx.runMutation(internal.duplicates.applyResolutions, { cacheRows, stamps });
    }

    if (!page.isDone && iteration < RESOLVE_MAX_ITER) {
      await ctx.scheduler.runAfter(0, internal.duplicates.resolveRepoIdentities, {
        cursor: page.nextCursor,
        iteration: iteration + 1,
      });
      return { stamped: stamps.length, resolvedRepos, done: false };
    }

    // Resolution finished — unconditionally refresh the denormalized copyCount.
    // This weekly full pass is the GUARANTEED backstop that corrects any drift
    // from the incremental paths (delist decrement, capped-budget overflow, a
    // relist rejoining a group). reresolveStaleRepoIdentities only chains this on
    // an actual id transition, so this is the single recompute that always runs.
    await ctx.scheduler.runAfter(0, internal.duplicates.computeCopyCounts, {});

    console.log(
      `resolveRepoIdentities: iteration ${iteration}, stamped ${stamps.length}, resolved ${resolvedRepos} new repos, done ${page.isDone}`,
    );
    return { stamped: stamps.length, resolvedRepos, done: page.isDone };
  },
});

// ---------------------------------------------------------------------------
// copyCount pass — denormalize "# of copies" onto each summary
// ---------------------------------------------------------------------------
//
// List/search rows show a "shared content" marker, but running the alias + fork
// lookups per row would be far too many queries per page. So precompute the
// count once and stamp it on the summary; the list query then has it for free.
// Runs after resolveRepoIdentities (needs githubRepoId populated) and is also
// chained from it. Counts are capped — the marker only needs "has copies (+N)".

// Each row does two capped index reads (aliasPeers ≤ GROUP_CAP+1, forkPeers ≤
// GROUP_CAP*2+1), so worst case is PAGE * (3*GROUP_CAP + 2) document reads in ONE
// mutation. Keep PAGE small enough that a page landing on many rows sharing a
// popular templated syncHash (large fork groups) stays well under Convex's
// per-transaction read budget: 25 * 302 ≈ 7.5k reads.
const COPYCOUNT_PAGE = 25;

export const computeCopyCountBatch = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db
      .query("skillSummaries")
      .withIndex("by_isDelisted", (q) => q.lt("isDelisted", true))
      .paginate(
        cursor ? { numItems: COPYCOUNT_PAGE, cursor } : { numItems: COPYCOUNT_PAGE, cursor: null },
      );

    let updated = 0;
    for (const s of result.page) {
      const aliasCount = (await aliasPeers(ctx, s, COPYCOUNT_GROUP_CAP)).length;
      const forkCount = (await forkPeers(ctx, s, COPYCOUNT_GROUP_CAP)).length;
      const copyCount = aliasCount + forkCount;
      if ((s.copyCount ?? 0) !== copyCount) {
        await ctx.db.patch(s._id, { copyCount });
        updated++;
      }
    }

    return { nextCursor: result.continueCursor, isDone: result.isDone, updated };
  },
});

export const computeCopyCounts = internalAction({
  args: { cursor: v.optional(v.string()), iteration: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ done: boolean; updatedThisBatch: number }> => {
    const iteration = args.iteration ?? 0;
    const res = await ctx.runMutation(internal.duplicates.computeCopyCountBatch, {
      cursor: args.cursor,
    });
    if (!res.isDone && iteration < 500) {
      await ctx.scheduler.runAfter(0, internal.duplicates.computeCopyCounts, {
        cursor: res.nextCursor,
        iteration: iteration + 1,
      });
      return { done: false, updatedThisBatch: res.updated };
    }
    console.log(`computeCopyCounts: done (iteration ${iteration})`);
    return { done: res.isDone, updatedThisBatch: res.updated };
  },
});

// ---------------------------------------------------------------------------
// Re-resolution — catch repos that rename AFTER they were first stamped
// ---------------------------------------------------------------------------
//
// resolveRepoIdentities only resolves rows with githubRepoId === undefined, so a
// repo that renames *after* it's been stamped keeps a stale repoLiveName forever:
// its old-name row is never recognized as a dead alias, never shows the rename
// banner, and (off-board) never delists, because reconcile keeps "keeping it
// alive" and may re-inflate it from the detail endpoint. This pass periodically
// re-checks already-resolved repos against GitHub and re-stamps their summaries
// when the identity moved. Once an old name's repoLiveName flips to the new live
// name, reconcile recognizes it as a dead alias and skips it, so it delists on
// the normal 30-day track.

// Re-check each repo at most this often. Renames are rare, so a ~2 week floor
// keeps GitHub traffic low; with a token (5000/hr) re-checking the whole set is
// still trivial. Paired with the weekly cron, effective cadence is ~2-3 weeks.
const RERESOLVE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const RERESOLVE_PAGE = 100;
const RERESOLVE_MAX_ITER = 400;
// Cap summaries re-stamped per repo so a repo with very many skills can't blow
// the mutation read budget.
const RESTAMP_CAP = 200;

export const listResolutionsPage = internalQuery({
  args: { cutoff: v.number(), cursor: v.optional(v.string()) },
  handler: async (ctx, { cutoff, cursor }) => {
    const result = await ctx.db
      .query("githubRepoResolution")
      .paginate(
        cursor
          ? { numItems: RERESOLVE_PAGE, cursor }
          : { numItems: RERESOLVE_PAGE, cursor: null },
      );
    // Only the stale rows are work; fresh ones in the page are skipped. (Paging
    // by _creationTime, which is stable under the resolvedAt patches we make, so
    // no row is skipped or seen twice across pages.)
    const stale = result.page
      .filter((r) => r.resolvedAt < cutoff)
      .map((r) => ({ repo: r.repo, repoId: r.repoId, liveName: r.liveName }));
    return { stale, nextCursor: result.continueCursor, isDone: result.isDone };
  },
});

export const applyReresolutions = internalMutation({
  args: {
    updates: v.array(
      v.object({
        repo: v.string(),
        repoId: v.union(v.number(), v.null()),
        liveName: v.union(v.string(), v.null()),
        changed: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, { updates }) => {
    const now = Date.now();
    let restamped = 0;
    for (const u of updates) {
      const existing = await ctx.db
        .query("githubRepoResolution")
        .withIndex("by_repo", (q) => q.eq("repo", u.repo))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, {
          repoId: u.repoId,
          liveName: u.liveName,
          resolvedAt: now,
        });
      }
      if (!u.changed) continue;
      // Re-stamp every summary for this repo. The repo's `source` string is the
      // key we resolved, so by_source_skillId(eq source) gathers its skills.
      // repoId is stable across a rename; only repoLiveName moves — but handle
      // id transitions (404 recovery / deletion) via the sentinel too.
      const newRepoId = u.repoId ?? REPO_ID_NONE;
      const newLiveName = u.liveName ?? "";
      const summaries = await ctx.db
        .query("skillSummaries")
        .withIndex("by_source_skillId", (q) => q.eq("source", u.repo))
        .take(RESTAMP_CAP);
      for (const s of summaries) {
        if (s.githubRepoId !== newRepoId || s.repoLiveName !== newLiveName) {
          await ctx.db.patch(s._id, {
            githubRepoId: newRepoId,
            repoLiveName: newLiveName,
          });
          restamped++;
        }
      }
    }
    return { restamped };
  },
});

export const reresolveStaleRepoIdentities = internalAction({
  args: {
    cursor: v.optional(v.string()),
    iteration: v.optional(v.number()),
    // Carried across continuations: did any repo's id actually TRANSITION (404
    // recovery / deletion)? A plain rename only moves repoLiveName, which doesn't
    // change alias/fork group membership, so copyCount only needs a recompute on
    // a real id change — rare, so most runs skip the chained full scan entirely.
    idChangedAny: v.optional(v.boolean()),
  },
  // Explicit annotation — see resolveRepoIdentities.
  handler: async (
    ctx,
    args,
  ): Promise<{ reresolved: number; changed: number; done: boolean }> => {
    const iteration = args.iteration ?? 0;
    const cutoff = Date.now() - RERESOLVE_TTL_MS;
    const page = await ctx.runQuery(internal.duplicates.listResolutionsPage, {
      cutoff,
      cursor: args.cursor,
    });

    const updates: {
      repo: string;
      repoId: number | null;
      liveName: string | null;
      changed: boolean;
    }[] = [];
    let changed = 0;
    let idChanged = 0; // repoId transitions (not mere renames)

    for (const row of page.stale) {
      const r = await resolveRepoIdentity(row.repo);
      if (r.status === "rate_limited") {
        if (updates.length > 0) {
          await ctx.runMutation(internal.duplicates.applyReresolutions, { updates });
        }
        // Resume the SAME page in 60s: rows we just stamped have resolvedAt=now
        // and fall out of the stale filter, so they aren't re-processed.
        await ctx.scheduler.runAfter(60_000, internal.duplicates.reresolveStaleRepoIdentities, {
          cursor: args.cursor,
          iteration: iteration + 1,
          idChangedAny: (args.idChangedAny ?? false) || idChanged > 0,
        });
        return { reresolved: updates.length, changed, done: false };
      }
      if (r.status === "error") {
        // Transient — leave resolvedAt untouched so it's retried next cycle.
        continue;
      }
      const newRepoId = r.status === "ok" ? r.repoId : null;
      const newLiveName = r.status === "ok" ? r.liveName : null;
      const idTransition = newRepoId !== row.repoId;
      const didChange = idTransition || newLiveName !== row.liveName;
      if (didChange) changed++;
      if (idTransition) idChanged++;
      updates.push({ repo: row.repo, repoId: newRepoId, liveName: newLiveName, changed: didChange });
    }

    if (updates.length > 0) {
      await ctx.runMutation(internal.duplicates.applyReresolutions, { updates });
    }

    const idChangedAny = (args.idChangedAny ?? false) || idChanged > 0;

    if (!page.isDone && iteration < RERESOLVE_MAX_ITER) {
      await ctx.scheduler.runAfter(0, internal.duplicates.reresolveStaleRepoIdentities, {
        cursor: page.nextCursor,
        iteration: iteration + 1,
        idChangedAny,
      });
      return { reresolved: updates.length, changed, done: false };
    }

    // Only repo-id transitions (404 recovery / deletion) change group membership;
    // plain renames don't. So recompute copyCount only when an id actually moved
    // — otherwise this weekly pass adds no second full scan.
    if (idChangedAny) {
      await ctx.scheduler.runAfter(0, internal.duplicates.computeCopyCounts, {});
    }
    console.log(
      `reresolveStaleRepoIdentities: done (iteration ${iteration}, reresolved ${updates.length}, changed ${changed}, idChanged ${idChangedAny})`,
    );
    return { reresolved: updates.length, changed, done: true };
  },
});

// ---------------------------------------------------------------------------
// Read query — relationships for the skill detail page
// ---------------------------------------------------------------------------

export const getSkillCopies = query({
  args: { source: v.string(), skillId: v.string() },
  handler: async (ctx, { source, skillId }) => {
    const self = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", source).eq("skillId", skillId),
      )
      .unique();
    if (!self) {
      return { renamedTo: null, aliases: [], forks: [] };
    }

    const liveName = self.repoLiveName;

    // Aliases (same repo, renamed) and forks (same content, different repo) both
    // come from the canonical grouping helpers, so list + detail can't disagree.
    const aliases = (await aliasPeers(ctx, self, COPIES_LIMIT))
      .slice(0, COPIES_LIMIT)
      .map((r) => ({
        source: r.source,
        skillId: r.skillId,
        installs: r.installs,
        isLive: r.source === r.repoLiveName,
      }));
    const forks = (await forkPeers(ctx, self, COPIES_LIMIT))
      .slice(0, COPIES_LIMIT)
      .map((r) => ({
        source: r.source,
        skillId: r.skillId,
        installs: r.installs,
      }));

    // renamedTo: this row is a dead alias when its repo's live name differs from
    // its own source. Only surface it when the live skill actually exists in our
    // DB — i.e. a non-delisted alias row at the live name (same repo id + slug).
    // That row is already in `aliases` flagged isLive. Synthesizing the link from
    // `repoLiveName` alone would 404 when the live repo was never synced, or when
    // the slug changed on rename.
    const liveAlias =
      liveName && liveName !== source
        ? aliases.find((a) => a.isLive)
        : undefined;
    const renamedTo = liveAlias
      ? { source: liveAlias.source, skillId: liveAlias.skillId }
      : null;

    return {
      renamedTo,
      aliases,
      forks,
      // The denormalized count the list marker reads (precomputed by
      // computeCopyCounts); exposed here too for parity/verification.
      copyCount: self.copyCount ?? 0,
    };
  },
});
