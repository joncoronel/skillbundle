/**
 * Tests for reconcileUnseenSkills classification (convex/reconcile.ts).
 *
 * The dead-alias skip is the qu-skills inflation guard: a stale, content-healthy
 * row whose repo was renamed (repoLiveName != source) must NOT be refreshed from
 * the detail endpoint (which serves a stale inflated count for the old name).
 * The dryRun path classifies without any detail calls or writes, so we assert
 * the dead alias is excluded from the healthy/refresh set.
 */
import { test, expect } from "vitest";
import { internal } from "../convex/_generated/api";
import type { MutationCtx } from "../convex/_generated/server";
import { makeTest } from "./_setup";

const STALE = Date.now() - 2 * 24 * 60 * 60 * 1000; // older than the 23h cutoff

async function seedStaleSummary(
  ctx: MutationCtx,
  fields: { source: string; skillId: string; repoLiveName?: string },
) {
  const skillDocId = await ctx.db.insert("skills", {
    source: fields.source,
    skillId: fields.skillId,
    name: fields.skillId,
    installs: 100,
    leaderboard: "all-time",
    lastSynced: STALE,
    lastSeenInApi: STALE,
    isDelisted: false,
  });
  await ctx.db.insert("skillSummaries", {
    source: fields.source,
    skillId: fields.skillId,
    name: fields.skillId,
    installs: 100,
    lastSeenInApi: STALE,
    skillDocId,
    isDelisted: false,
    // Content-healthy: discovered SKILL.md, no fetch error, discovery not exhausted.
    hasSkillMdUrl: true,
    hasContentFetchError: false,
    discoveryFailCount: 0,
    repoLiveName: fields.repoLiveName,
  });
}

test("reconcile dryRun excludes dead aliases from the healthy refresh set", async () => {
  const t = makeTest();

  await t.run(async (ctx) => {
    // Normal healthy off-board skill (live): repoLiveName === source -> refresh.
    await seedStaleSummary(ctx, {
      source: "owner/live",
      skillId: "s",
      repoLiveName: "owner/live",
    });
    // Dead alias: content-healthy but renamed (repoLiveName != source) -> must be
    // skipped so reconcile never re-fetches its inflated detail count.
    await seedStaleSummary(ctx, {
      source: "owner/old",
      skillId: "s",
      repoLiveName: "owner/new",
    });
  });

  const res = await t.action(internal.reconcile.reconcileUnseenSkills, {
    dryRun: true,
  });

  expect(res.bailed).toBe(false);
  expect(res.staleTotal).toBe(2);
  expect(res.healthy).toBe(1); // only owner/live would be refreshed
  expect(res.broke).toBe(1); // owner/old skipped as a dead alias
});
