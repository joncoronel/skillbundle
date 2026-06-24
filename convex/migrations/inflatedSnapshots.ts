// ---------------------------------------------------------------------------
// One-off migration: drop mis-attributed inflated snapshots
// ---------------------------------------------------------------------------
//
// A renamed-repo skill whose install count was corrected down (e.g. qu-skills
// 302k -> 12 once syncSkills started seeing its real bottom-of-leaderboard
// count) left an inflated pre-correction snapshot behind, drawing a cliff on its
// chart. Cumulative installs can't legitimately exceed the current total, so any
// snapshot far above the now-correct count is mis-attribution from skills.sh
// fragmenting installs across the repo's rename history. Drop those so the chart
// starts at the real number. Candidate set is the low-install tail (the corrected
// ghosts), so this is cheap.
//
// One-shot for the qu-skills incident — kept here out of the core sync module.
// Run with { dryRun: true } first:
//   npx convex run migrations/inflatedSnapshots:cleanupInflatedSnapshots '{"dryRun":true}'

import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { revalidateHomeTag } from "../lib/revalidate";

const SNAPSHOT_CLEANUP_INSTALL_CEIL = 1000;

export const listLowInstallSummaries = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db
      .query("skillSummaries")
      .withIndex("by_isDelisted_installs", (q) =>
        q.eq("isDelisted", false).lt("installs", SNAPSHOT_CLEANUP_INSTALL_CEIL),
      )
      .paginate(
        cursor ? { numItems: 200, cursor } : { numItems: 200, cursor: null },
      );
    return {
      entries: result.page.map((s) => ({
        skillDocId: s.skillDocId,
        source: s.source,
        skillId: s.skillId,
        installs: s.installs,
      })),
      nextCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const pruneInflatedSnapshots = internalMutation({
  args: {
    skillDocId: v.id("skills"),
    currentInstalls: v.number(),
    dryRun: v.boolean(),
  },
  handler: async (ctx, { skillDocId, currentInstalls, dryRun }) => {
    // Clearly-inflated = more than 2x the now-correct total (spares minor noise).
    const threshold = currentInstalls * 2 + 1;
    const snaps = await ctx.db
      .query("skillSnapshots")
      .withIndex("by_skill_day", (q) => q.eq("skillDocId", skillDocId))
      .collect();
    const inflated = snaps.filter((s) => s.installs > threshold);
    if (!dryRun) {
      for (const s of inflated) await ctx.db.delete(s._id);
    }
    const maxDropped = inflated.reduce((m, s) => Math.max(m, s.installs), 0);
    return { deleted: inflated.length, maxDropped };
  },
});

export const cleanupInflatedSnapshots = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (
    ctx,
    args,
  ): Promise<{
    dryRun: boolean;
    skillsFixed: number;
    snapshotsDeleted: number;
  }> => {
    const dryRun = args.dryRun ?? false;
    let skillsFixed = 0;
    let snapshotsDeleted = 0;
    let logged = 0;
    let cursor: string | undefined;
    let isDone = false;
    while (!isDone) {
      const page = await ctx.runQuery(
        internal.migrations.inflatedSnapshots.listLowInstallSummaries,
        { cursor },
      );
      for (const s of page.entries) {
        const res = await ctx.runMutation(
          internal.migrations.inflatedSnapshots.pruneInflatedSnapshots,
          {
            skillDocId: s.skillDocId,
            currentInstalls: s.installs,
            dryRun,
          },
        );
        if (res.deleted > 0) {
          skillsFixed++;
          snapshotsDeleted += res.deleted;
          if (logged < 50) {
            console.log(
              `  ${dryRun ? "would prune" : "pruned"} ${res.deleted} inflated snapshot(s) from ${s.source}/${s.skillId} (current ${s.installs}, max dropped ${res.maxDropped})`,
            );
            logged++;
          }
        }
      }
      cursor = page.nextCursor;
      isDone = page.isDone;
    }
    console.log(
      `cleanupInflatedSnapshots${dryRun ? " DRY RUN" : ""}: ${skillsFixed} skills, ${snapshotsDeleted} snapshots`,
    );
    if (!dryRun && skillsFixed > 0) await revalidateHomeTag("skill-sync");
    return { dryRun, skillsFixed, snapshotsDeleted };
  },
});
