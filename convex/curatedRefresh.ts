// ---------------------------------------------------------------------------
// Curated-only refresh
// ---------------------------------------------------------------------------
//
// Curated skills that never reach the leaderboard (installRank never set) get
// their installs ONLY from syncCurated — which deliberately doesn't write them
// (the curated endpoint's install number is unreliable). So their count freezes
// AND they never accumulate snapshots (no install chart). reconcile can't help:
// syncCurated stamps lastSeenInApi daily, so they're never "stale."
//
// This weekly pass detail-refreshes the healthy ones (detail is reliable for
// live skills): updates installs, writes a day-pinned snapshot, stamps
// lastSeenInApi. Skips dead aliases (detail's count is unreliable for a renamed
// repo's old name). Uses installRank===undefined as the "never on the
// leaderboard" signal, so it targets exactly the frozen curated-only set and
// skips skills syncSkills already owns.
//
// Why a separate job and not folded into reconcile (it's tempting — both find
// healthy off-board skills and refresh them through the same drainRefreshBatch):
// the two are driven by *different triggers that must stay distinct*. reconcile
// discovers work by staleness (lastSeenInApi < cutoff). syncCurated stamps
// lastSeenInApi daily as a PRESENCE signal — "still in the official curated feed"
// — which is what protects a curated row from the 30-day delist even when its
// detail endpoint is momentarily 404/broke. That stamp is exactly what hides
// these rows from reconcile's staleness scan. We can't drop it to let reconcile
// own them: reconcile only stamps rows it successfully detail-refreshes, so a
// curated skill with a broken detail endpoint would wrongly delist despite still
// being officially curated. Decoupling the refresh trigger from the presence
// stamp requires a separate discovery (this job) — folding it in would either
// change that delist semantics or move this query into reconcile, not delete it.

import { internalAction, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { revalidateHomeTag } from "./lib/revalidate";
import { appDay } from "./lib/appDay";
import { drainRefreshBatch } from "./lib/detailRefresh";
import { isDeadRenamedAlias } from "./lib/source";
import { summaryRefreshHealthy } from "./lib/skillHealth";
import { maxIterForRows, CATALOG_MAX_ROWS } from "./lib/pagination";

const CURATED_REFRESH_PAGE = 100;
// Drain backstop. The curated-only set is small (~hundreds), so the job exits on
// isDone far below this; bounded by the catalog as a safe generous ceiling.
const CURATED_MAX_ITER = maxIterForRows(CATALOG_MAX_ROWS, CURATED_REFRESH_PAGE);

export const listCuratedToRefresh = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db
      .query("skillSummaries")
      .withIndex("by_curatedOwner", (q) => q.gt("curatedOwner", ""))
      .paginate(
        cursor
          ? { numItems: CURATED_REFRESH_PAGE, cursor }
          : { numItems: CURATED_REFRESH_PAGE, cursor: null },
      );
    const items = result.page
      .filter((s) => !s.isDelisted)
      .filter((s) => s.installRank === undefined) // never on the leaderboard
      .filter((s) => summaryRefreshHealthy(s))
      .filter((s) => !isDeadRenamedAlias(s))
      .map((s) => ({
        source: s.source,
        skillId: s.skillId,
        name: s.name,
        isDuplicate: s.isDuplicate ?? false,
      }));
    return { items, nextCursor: result.continueCursor, isDone: result.isDone };
  },
});

export const refreshCuratedSkills = internalAction({
  args: {
    cursor: v.optional(v.string()),
    iteration: v.optional(v.number()),
    day: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ refreshed: number; gone: number; done: boolean }> => {
    const day = args.day ?? appDay(Date.now() - 60 * 60 * 1000);
    const iteration = args.iteration ?? 0;

    const page = await ctx.runQuery(
      internal.curatedRefresh.listCuratedToRefresh,
      { cursor: args.cursor },
    );

    const { refreshed, gone, rateLimitedAfter } = await drainRefreshBatch(
      ctx,
      page.items,
      { day, leaderboard: "curated" },
    );

    if (refreshed > 0) await revalidateHomeTag("skill-sync");

    if (rateLimitedAfter !== undefined) {
      await ctx.scheduler.runAfter(
        rateLimitedAfter * 1000,
        internal.curatedRefresh.refreshCuratedSkills,
        { cursor: args.cursor, iteration: iteration + 1, day },
      );
      return { refreshed, gone, done: false };
    }

    if (!page.isDone && iteration < CURATED_MAX_ITER) {
      await ctx.scheduler.runAfter(0, internal.curatedRefresh.refreshCuratedSkills, {
        cursor: page.nextCursor,
        iteration: iteration + 1,
        day,
      });
      return { refreshed, gone, done: false };
    }

    console.log(`refreshCuratedSkills: done (iteration ${iteration})`);
    return { refreshed, gone, done: page.isDone };
  },
});
