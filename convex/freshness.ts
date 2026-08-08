/**
 * Daily per-repo freshness sweep.
 *
 * ## What it replaces, and what it does not
 *
 * Finding out whether a skill changed used to mean downloading its SKILL.md and
 * hashing it — `markStaleContent` re-flags every row whose `contentFetchedAt` is
 * older than 7 days, so the catalog costs ~1,360 file downloads a day just to
 * discover that almost nothing moved.
 *
 * GitHub already tells us. Every entry in the recursive tree response carries a
 * blob SHA, and we now store it as `githubBlobSha` (see the field's note in
 * schema.ts). So one conditional tree call per REPO answers the question for
 * every skill in it, and only the files whose SHA actually moved get fetched.
 *
 * The catalog is ~98% GitHub sources clustering at ~6.8 skills per repo, so the
 * arithmetic works out at roughly 1,400 mostly-304 tree calls plus ~265 real
 * downloads per day — fewer downloads than today's WEEKLY cycle, at daily
 * resolution.
 *
 * ## This is an accelerator, not a replacement
 *
 * `markStaleContent` stays exactly as it is, on its 7-day cadence. This sweep
 * runs alongside it and only ever flags rows EARLIER than the timer would have.
 * That ordering matters:
 *
 *   - Well-known sources (~1.8%) have no tree to walk and are skipped here.
 *   - A repo whose tree fetch fails is skipped rather than guessed at.
 *   - A skill with no stored SHA yet is skipped until discovery gives it one.
 *   - If a content fetch fails after this flags it, the SHA has already been
 *     advanced and the sweep will not re-flag it.
 *
 * Every one of those is a gap, and the 7-day timer closes all of them. Deleting
 * it to "save" the duplicate work would trade a bounded cost for an unbounded
 * correctness hole.
 */
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { fetchRepoTree, indexSkillMds, NOT_MODIFIED } from "./lib/github";
import { isGitHubSource } from "./lib/source";

/** Repos inspected per action invocation before chaining. */
const REPOS_PER_BATCH = 40;
/** Rows read per page. Kept well under Convex's limits; ~6.8 skills per repo. */
const SUMMARY_PAGE = 400;

/**
 * Recover a tree path from a stored raw URL.
 *
 * `skillMdUrl` is built by `rawGitHubUrl` as
 * `https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path...}`, and the
 * tree indexes SHAs by that trailing path. Nothing else on the row records it,
 * so the URL is the only place to get it back.
 *
 * Returns null on anything that does not match the shape, which is the correct
 * outcome for a GitHub-only row pointing somewhere unexpected: skip it and let
 * the timer handle that skill.
 */
export function pathFromRawUrl(url: string): string | null {
  const match = url.match(
    /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.+)$/,
  );
  return match ? match[1] : null;
}

type SweepSkill = {
  skillDocId: Id<"skills">;
  skillId: string;
  path: string;
  githubBlobSha?: string;
};

/**
 * One page of live GitHub-source skills, grouped by repo.
 *
 * Paginates the `by_source_skillId` index specifically because it orders rows by
 * source, so a repo's skills arrive contiguously and grouping is free. A repo
 * straddling a page boundary is swept twice; that is harmless (the second tree
 * call 304s and the per-skill comparison is idempotent) and cheaper than
 * carrying partial groups across invocations.
 */
export const listSummariesForSweep = internalQuery({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({
    repos: v.array(
      v.object({
        source: v.string(),
        skills: v.array(
          v.object({
            skillDocId: v.id("skills"),
            skillId: v.string(),
            path: v.string(),
            githubBlobSha: v.optional(v.string()),
          }),
        ),
      }),
    ),
    nextCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId")
      .paginate({ numItems: SUMMARY_PAGE, cursor: cursor ?? null });

    const bySource = new Map<string, SweepSkill[]>();
    for (const s of result.page) {
      // Delisted rows are hidden everywhere and not worth a request; well-known
      // sources have no tree; a row without a resolved URL has no path to
      // compare and is still waiting on discovery.
      if (s.isDelisted) continue;
      if (!isGitHubSource(s.source)) continue;
      if (!s.skillMdUrl) continue;

      const path = pathFromRawUrl(s.skillMdUrl);
      if (!path) continue;

      const list = bySource.get(s.source) ?? [];
      list.push({
        skillDocId: s.skillDocId,
        skillId: s.skillId,
        path,
        githubBlobSha: s.githubBlobSha,
      });
      bySource.set(s.source, list);
    }

    return {
      repos: Array.from(bySource.entries()).map(([source, skills]) => ({
        source,
        skills,
      })),
      nextCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const getSweepState = internalQuery({
  args: { repo: v.string() },
  returns: v.union(
    v.null(),
    v.object({ branch: v.string(), etag: v.optional(v.string()) }),
  ),
  handler: async (ctx, { repo }) => {
    const row = await ctx.db
      .query("repoSweepState")
      .withIndex("by_repo", (q) => q.eq("repo", repo))
      .unique();
    return row ? { branch: row.branch, etag: row.etag } : null;
  },
});

/**
 * Record one repo's sweep: flag the skills whose blob SHA moved, and store the
 * ETag so the next pass can ask conditionally.
 *
 * The new SHA is written at the same time as the flag, NOT after the content
 * fetch succeeds. That is a deliberate trade: carrying a pending-SHA column
 * would be the precise fix, but it doubles the state for a case the 7-day timer
 * already recovers — a failed fetch sets `hasContentFetchError`, and two
 * failures re-queue discovery, which rewrites the SHA anyway.
 */
export const applySweepResult = internalMutation({
  args: {
    repo: v.string(),
    branch: v.string(),
    etag: v.optional(v.string()),
    changed: v.array(
      v.object({
        skillDocId: v.id("skills"),
        githubBlobSha: v.string(),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, { repo, branch, etag, changed }) => {
    for (const { skillDocId, githubBlobSha } of changed) {
      const skill = await ctx.db.get(skillDocId);
      if (!skill) continue;

      await ctx.db.patch(skillDocId, {
        needsContentFetch: true,
        githubBlobSha,
      });

      const summary = await ctx.db
        .query("skillSummaries")
        .withIndex("by_skillDocId", (q) => q.eq("skillDocId", skillDocId))
        .unique();
      if (summary) {
        await ctx.db.patch(summary._id, {
          needsContentFetch: true,
          githubBlobSha,
        });
      }
    }

    const existing = await ctx.db
      .query("repoSweepState")
      .withIndex("by_repo", (q) => q.eq("repo", repo))
      .unique();
    const state = { repo, branch, etag, sweptAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, state);
    } else {
      await ctx.db.insert("repoSweepState", state);
    }

    return changed.length;
  },
});

/**
 * Walk the catalog one page of repos at a time, chaining until done.
 *
 * Self-chaining rather than looping in one action: the catalog is ~1,400 repos
 * and a single invocation would run past its time budget, the same reason
 * `backfillDiscoverUrls` chains.
 */
export const sweepRepoFreshness = internalAction({
  args: {
    cursor: v.optional(v.string()),
    reposSwept: v.optional(v.number()),
    skillsFlagged: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { cursor, reposSwept = 0, skillsFlagged = 0 }) => {
    const page: {
      repos: Array<{ source: string; skills: SweepSkill[] }>;
      nextCursor: string;
      isDone: boolean;
    } = await ctx.runQuery(internal.freshness.listSummariesForSweep, {
      cursor: cursor ?? undefined,
    });

    const batch = page.repos.slice(0, REPOS_PER_BATCH);
    let swept = reposSwept;
    let flagged = skillsFlagged;

    for (const repo of batch) {
      const [owner, name] = repo.source.split("/");
      if (!owner || !name) continue;

      const state = await ctx.runQuery(internal.freshness.getSweepState, {
        repo: repo.source,
      });

      // Try the remembered branch first so the stored ETag is actually valid
      // for the request; `fetchRepoTree` only sends If-None-Match for the first
      // branch it tries.
      const branches = state?.branch
        ? [state.branch, "main", "master"]
        : ["main", "master"];

      const tree = await fetchRepoTree(owner, name, branches, {
        etag: state?.etag,
      });

      swept++;

      // Nothing in the entire repo changed. This is the common case and the
      // whole point: no body transferred, no rate-limit cost, and every skill
      // in the repo is settled by one request.
      if (tree === NOT_MODIFIED) continue;

      // 404, rate limit, or a repo too large for the Tree API. Leave the rows
      // alone; the 7-day timer is the backstop for exactly this.
      if (!tree) continue;

      const { shaByPath } = indexSkillMds(tree.entries);

      const changed = repo.skills.flatMap((s) => {
        const current = shaByPath.get(s.path);
        // Not in the tree: the file moved or was deleted. Discovery owns
        // re-resolving that, so don't guess at it here.
        if (!current) return [];
        // No stored SHA yet (discovery hasn't run since the field was added).
        // Record it without flagging — flagging every such row on the first
        // sweep would queue a full-catalog re-fetch for no reason.
        if (!s.githubBlobSha) {
          return [{ skillDocId: s.skillDocId, githubBlobSha: current }];
        }
        if (s.githubBlobSha === current) return [];
        return [{ skillDocId: s.skillDocId, githubBlobSha: current }];
      });

      const wrote: number = await ctx.runMutation(
        internal.freshness.applySweepResult,
        {
          repo: repo.source,
          branch: tree.branch,
          etag: tree.etag,
          changed,
        },
      );
      flagged += wrote;
    }

    const remaining = page.repos.length - batch.length;
    if (remaining > 0 || !page.isDone) {
      await ctx.scheduler.runAfter(1_000, internal.freshness.sweepRepoFreshness, {
        // Only advance the cursor once this page's repos are all consumed.
        cursor: remaining > 0 ? (cursor ?? undefined) : page.nextCursor,
        reposSwept: swept,
        skillsFlagged: flagged,
      });
      return null;
    }

    console.log(
      `Freshness sweep complete: ${swept} repos inspected, ${flagged} skills flagged for re-fetch`,
    );
    // Drain whatever the sweep queued. Safe when nothing was flagged —
    // backfillFetchContent no-ops on an empty work set.
    if (flagged > 0) {
      await ctx.scheduler.runAfter(5_000, internal.skills.backfillFetchContent, {});
    }
    return null;
  },
});
