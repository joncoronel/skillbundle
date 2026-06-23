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
} from "./_generated/server";
import { internal } from "./_generated/api";
import { isGitHubSource } from "./skills";
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

// ---------------------------------------------------------------------------
// Resolution job
// ---------------------------------------------------------------------------

export const listResolutionCache = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("githubRepoResolution").collect();
    return rows.map((r) => ({
      repo: r.repo,
      repoId: r.repoId,
      liveName: r.liveName,
    }));
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

    // Per-invocation in-memory cache: seed from the persisted resolution table,
    // then add repos we resolve this run. Keyed by "owner/repo".
    const cache = new Map<string, { repoId: number | null; liveName: string | null }>();
    const persisted = await ctx.runQuery(internal.duplicates.listResolutionCache, {});
    for (const r of persisted) cache.set(r.repo, { repoId: r.repoId, liveName: r.liveName });

    const page = await ctx.runQuery(internal.duplicates.listSummariesToResolve, {
      cursor: args.cursor,
    });

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

    // Resolution finished — repo ids are populated, so refresh the denormalized
    // copyCount that the list "shared content" marker reads.
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

const COPYCOUNT_PAGE = 100;
const COPYCOUNT_GROUP_CAP = 100;

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
      const repoId = s.githubRepoId;

      // Aliases: same repo id + slug, different source.
      let aliasCount = 0;
      if (repoId !== undefined && repoId !== REPO_ID_NONE) {
        const rows = await ctx.db
          .query("skillSummaries")
          .withIndex("by_repo_skill", (q) =>
            q.eq("githubRepoId", repoId).eq("skillId", s.skillId),
          )
          .take(COPYCOUNT_GROUP_CAP + 1);
        aliasCount = rows.filter((r) => r.source !== s.source && !r.isDelisted).length;
      }

      // Forks: same content hash, different real repo id.
      let forkCount = 0;
      if (s.syncHash) {
        const rows = await ctx.db
          .query("skillSummaries")
          .withIndex("by_syncHash", (q) => q.eq("syncHash", s.syncHash))
          .take(COPYCOUNT_GROUP_CAP * 2 + 1);
        forkCount = rows.filter(
          (r) =>
            r.source !== s.source &&
            !r.isDelisted &&
            r.githubRepoId !== undefined &&
            r.githubRepoId !== REPO_ID_NONE &&
            r.githubRepoId !== repoId,
        ).length;
      }

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

    const repoId = self.githubRepoId;
    const liveName = self.repoLiveName;
    const hash = self.syncHash;

    // Aliases: same repo id + same slug, different source. (Skip the no-id
    // sentinel and well-known sources, which have no repo id.)
    const aliases: {
      source: string;
      skillId: string;
      installs: number;
      isLive: boolean;
    }[] = [];
    if (repoId !== undefined && repoId !== REPO_ID_NONE) {
      const rows = await ctx.db
        .query("skillSummaries")
        .withIndex("by_repo_skill", (q) =>
          q.eq("githubRepoId", repoId).eq("skillId", skillId),
        )
        .take(COPIES_LIMIT + 1);
      for (const r of rows) {
        if (r.source === source) continue;
        if (r.isDelisted) continue;
        aliases.push({
          source: r.source,
          skillId: r.skillId,
          installs: r.installs,
          isLive: r.source === r.repoLiveName,
        });
      }
    }

    // Forks: same content hash, different repo id (genuine separate repos).
    const forks: { source: string; skillId: string; installs: number }[] = [];
    if (hash) {
      const rows = await ctx.db
        .query("skillSummaries")
        .withIndex("by_syncHash", (q) => q.eq("syncHash", hash))
        .take(COPIES_LIMIT * 2 + 1);
      for (const r of rows) {
        if (r.source === source) continue;
        if (r.isDelisted) continue;
        // Only classify as a fork when the other row is resolved to a real,
        // DIFFERENT repo id. Unresolved (undefined) or no-id (sentinel) rows
        // can't be classified yet — skip them rather than mislabel an alias.
        if (r.githubRepoId === undefined || r.githubRepoId === REPO_ID_NONE) {
          continue;
        }
        if (r.githubRepoId === repoId) continue; // same repo = alias (above)
        forks.push({
          source: r.source,
          skillId: r.skillId,
          installs: r.installs,
        });
        if (forks.length >= COPIES_LIMIT) break;
      }
    }

    // renamedTo: this row is a dead alias when its repo's live name differs from
    // its own source. Point at the live skill (same slug, the live name).
    const renamedTo =
      liveName && liveName !== source
        ? { source: liveName, skillId }
        : null;

    return {
      renamedTo,
      aliases: aliases.slice(0, COPIES_LIMIT),
      forks,
      // The denormalized count the list marker reads (precomputed by
      // computeCopyCounts); exposed here too for parity/verification.
      copyCount: self.copyCount ?? 0,
    };
  },
});
