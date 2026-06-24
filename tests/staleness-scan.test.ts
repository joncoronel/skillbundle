/**
 * Tests for the indexed staleness scans (convex/skills.ts):
 *
 *   - listUnseenSummaries (reconcile's 23h refresh scan)
 *   - listStaleSummaries (markDelistedSkills' 30-day delist scan)
 *
 * Both query by_isDelisted_lastSeenInApi with q.eq("isDelisted", false)
 * .lt("lastSeenInApi", cutoff), so they must return ONLY non-delisted rows
 * older than the cutoff: fresh rows and delisted rows are excluded by the index
 * range itself, not an in-memory filter.
 */
import { test, expect } from "vitest";
import { internal } from "../convex/_generated/api";
import type { MutationCtx } from "../convex/_generated/server";
import { makeTest } from "./_setup";

const DAY = 24 * 60 * 60 * 1000;

async function seedSummary(
  ctx: MutationCtx,
  fields: {
    source: string;
    skillId: string;
    lastSeenInApi: number;
    isDelisted?: boolean;
  },
) {
  const skillDocId = await ctx.db.insert("skills", {
    source: fields.source,
    skillId: fields.skillId,
    name: fields.skillId,
    installs: 100,
    leaderboard: "all-time",
    lastSynced: fields.lastSeenInApi,
    lastSeenInApi: fields.lastSeenInApi,
    isDelisted: fields.isDelisted ?? false,
  });
  await ctx.db.insert("skillSummaries", {
    source: fields.source,
    skillId: fields.skillId,
    name: fields.skillId,
    installs: 100,
    lastSeenInApi: fields.lastSeenInApi,
    skillDocId,
    isDelisted: fields.isDelisted ?? false,
    hasSkillMdUrl: true,
  });
}

test("listUnseenSummaries returns only non-delisted rows older than the cutoff", async () => {
  const t = makeTest();
  const now = Date.now();

  await t.run(async (ctx) => {
    // Fresh: seen now -> not stale -> excluded.
    await seedSummary(ctx, { source: "a/fresh", skillId: "s", lastSeenInApi: now });
    // Stale: seen 2 days ago -> included.
    await seedSummary(ctx, { source: "a/stale", skillId: "s", lastSeenInApi: now - 2 * DAY });
    // Stale but delisted -> excluded by the isDelisted=false range.
    await seedSummary(ctx, {
      source: "a/delisted",
      skillId: "s",
      lastSeenInApi: now - 5 * DAY,
      isDelisted: true,
    });
  });

  const page = await t.query(internal.reconcile.listUnseenSummaries, {
    cutoff: now - DAY,
  });
  expect(page.entries.map((e: { source: string }) => e.source)).toEqual(["a/stale"]);
  expect(page.isDone).toBe(true);
});

test("listStaleSummaries returns only non-delisted rows older than the cutoff", async () => {
  const t = makeTest();
  const now = Date.now();

  await t.run(async (ctx) => {
    await seedSummary(ctx, { source: "b/fresh", skillId: "s", lastSeenInApi: now });
    await seedSummary(ctx, { source: "b/stale", skillId: "s", lastSeenInApi: now - 40 * DAY });
    await seedSummary(ctx, {
      source: "b/delisted",
      skillId: "s",
      lastSeenInApi: now - 90 * DAY,
      isDelisted: true,
    });
  });

  const page = await t.query(internal.skills.listStaleSummaries, {
    cutoff: now - 30 * DAY,
  });
  expect(page.entries.map((e: { source: string }) => e.source)).toEqual(["b/stale"]);
  expect(page.isDone).toBe(true);
});
