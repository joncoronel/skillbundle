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

import { internalAction, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  getSkillDetail as v1GetSkillDetail,
  SkillsApiNotFoundError,
  SkillsApiRateLimitError,
  withTransientRetry,
} from "./lib/skillsApi";
import { revalidateHomeTag } from "./lib/revalidate";
import { appDay } from "./lib/appDay";
import { isReconcileHealthy } from "./reconcile";

const CURATED_REFRESH_PAGE = 100;

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
      .filter((s) =>
        isReconcileHealthy({
          hasSkillMdUrl: s.hasSkillMdUrl ?? false,
          hasContentFetchError: s.hasContentFetchError ?? false,
          discoveryFailCount: s.discoveryFailCount ?? 0,
        }),
      )
      .filter((s) => !(s.repoLiveName !== undefined && s.repoLiveName !== s.source))
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

    let refreshed = 0;
    let gone = 0;
    for (const s of page.items) {
      try {
        const detail = await withTransientRetry(() =>
          v1GetSkillDetail(s.source, s.skillId),
        );
        await ctx.runMutation(internal.skills.upsertSkillsBatch, {
          skills: [
            {
              source: s.source,
              skillId: s.skillId,
              name: s.name,
              installs: detail.installs,
              isDuplicate: s.isDuplicate,
            },
          ],
          leaderboard: "curated",
          day,
        });
        refreshed++;
      } catch (err) {
        if (err instanceof SkillsApiNotFoundError) {
          gone++;
          continue;
        }
        if (err instanceof SkillsApiRateLimitError) {
          if (refreshed > 0) await revalidateHomeTag("skill-sync");
          await ctx.scheduler.runAfter(
            err.retryAfterSeconds * 1000,
            internal.curatedRefresh.refreshCuratedSkills,
            { cursor: args.cursor, iteration: iteration + 1, day },
          );
          return { refreshed, gone, done: false };
        }
        console.error(
          `refreshCuratedSkills failed for ${s.source}/${s.skillId}:`,
          err,
        );
      }
    }

    if (refreshed > 0) await revalidateHomeTag("skill-sync");

    if (!page.isDone && iteration < 200) {
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
