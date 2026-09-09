/**
 * DELETE ON COMPLETION — one-shot repair, Sep 2026.
 *
 * Run:
 *   npx convex run momentumFieldsRepair:clearOnSkills --prod
 *
 * Exit condition: the final log line reads `cleared 0` on a full pass, i.e. no
 * `skills` row still carries a momentum field. Then delete this file, and (see
 * TODO.md "Momentum fields on `skills`") drop the five fields from the `skills`
 * table in `convex/schema.ts`.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * `convex/leaderboards.ts` used to mirror `trendingRank`, `trendingInstalls`,
 * `hotRank`, `hotChange` and `hotInstallsYesterday` onto the ~10 KB `skills`
 * row every time it stamped the ~1.3 KB `skillSummaries` row. That mirror was
 * removed (the header there carries the measurement and the argument). Nothing
 * reads these fields from `skills`, so the values left behind are inert — but
 * inert data that LOOKS live is a trap for the next reader, and the fields
 * cannot be dropped from the schema while documents still carry them.
 *
 * ── Cost ──────────────────────────────────────────────────────────────────
 *
 * One full walk of `skills`: ~16k rows at ~10 KB = ~160 MB of database
 * bandwidth, against a 50 GB monthly allowance. Affordable once. It is a
 * one-shot precisely because it is not affordable on a schedule — that is the
 * whole reason the hourly mirror was removed.
 *
 * Batches are 200 rather than the 500 used elsewhere: these are the 10 KB rows,
 * so 500 of them is ~5 MB in a single transaction.
 */

import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

const BATCH = 200;

export const clearOnSkills = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    clearedSoFar: v.optional(v.number()),
    scannedSoFar: v.optional(v.number()),
  },
  handler: async (ctx, { cursor, clearedSoFar, scannedSoFar }) => {
    const page = await ctx.db
      .query("skills")
      .paginate({ numItems: BATCH, cursor: cursor ?? null });

    let cleared = clearedSoFar ?? 0;
    const scanned = (scannedSoFar ?? 0) + page.page.length;

    for (const skill of page.page) {
      // Only patch rows that actually carry one, so a re-run after a partial
      // pass costs reads and no writes.
      const hasAny =
        skill.trendingRank !== undefined ||
        skill.trendingInstalls !== undefined ||
        skill.hotRank !== undefined ||
        skill.hotChange !== undefined ||
        skill.hotInstallsYesterday !== undefined;
      if (!hasAny) continue;

      await ctx.db.patch(skill._id, {
        trendingRank: undefined,
        trendingInstalls: undefined,
        hotRank: undefined,
        hotChange: undefined,
        hotInstallsYesterday: undefined,
      });
      cleared++;
    }

    if (page.isDone) {
      console.log(
        `momentumFieldsRepair: DONE — cleared ${cleared}, scanned ${scanned}`,
      );
      return { isDone: true, cleared, scanned };
    }

    await ctx.scheduler.runAfter(
      0,
      internal.momentumFieldsRepair.clearOnSkills,
      {
        cursor: page.continueCursor,
        clearedSoFar: cleared,
        scannedSoFar: scanned,
      },
    );
    return { isDone: false, cleared, scanned };
  },
});
