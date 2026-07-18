/**
 * Regression coverage for Plan 007: bounding the /dev dashboard's
 * `retryBatch("noUrlExhausted")` mutation.
 *
 * The mutation used to `.collect()` the entire `by_hasSkillMdUrl` range and
 * filter/slice in memory. It now reads through the compound
 * `by_hasSkillMdUrl_discoveryFailCount` index with
 * `.gte("discoveryFailCount", MAX_DISCOVERY_FAILURES)`. Convex orders
 * missing values before all numbers in an index range, so a row with
 * `discoveryFailCount` unset is excluded from a `.gte` range — matching the
 * old post-filter semantics where `(s.discoveryFailCount ?? 0) >= 3` is
 * false for an unset field. This test asserts that equivalence holds and
 * that only the exhausted rows (failCount 3 and 5) get reset.
 *
 * Pattern follows tests/content-fetch-failure.test.ts.
 */
import { test, expect } from "vitest";
import { internal } from "../convex/_generated/api";
import { makeTest } from "./_setup";

async function seedSkill(
  t: ReturnType<typeof makeTest>,
  skillId: string,
  discoveryFailCount: number | undefined,
) {
  const now = Date.now();
  return t.run(async (ctx) => {
    const id = await ctx.db.insert("skills", {
      source: "x/y",
      skillId,
      name: skillId,
      installs: 10,
      leaderboard: "all-time",
      lastSynced: now,
      lastSeenInApi: now,
      isDelisted: false,
      skillMdUrl: "",
      needsContentFetch: false,
      needsDiscovery: false,
      ...(discoveryFailCount === undefined ? {} : { discoveryFailCount }),
    });
    await ctx.db.insert("skillSummaries", {
      source: "x/y",
      skillId,
      name: skillId,
      installs: 10,
      lastSeenInApi: now,
      skillDocId: id,
      isDelisted: false,
      skillMdUrl: "",
      hasSkillMdUrl: false,
      needsContentFetch: false,
      needsDiscovery: false,
      ...(discoveryFailCount === undefined ? {} : { discoveryFailCount }),
    });
    return id;
  });
}

test("retryBatch(noUrlExhausted) resets only rows at/above the fail-count threshold", async () => {
  const t = makeTest();

  await seedSkill(t, "fail-0", 0);
  await seedSkill(t, "fail-2", 2);
  const fail3 = await seedSkill(t, "fail-3", 3);
  const fail5 = await seedSkill(t, "fail-5", 5);
  await seedSkill(t, "fail-unset", undefined);

  const result = await t.mutation(internal.devStats.retryBatch, {
    filter: "noUrlExhausted",
  });

  expect(result.count).toBe(2);

  await t.run(async (ctx) => {
    const untouchedIds: Array<[string, unknown]> = [];
    for (const skillId of ["fail-0", "fail-2", "fail-unset"]) {
      const summary = await ctx.db
        .query("skillSummaries")
        .withIndex("by_source_skillId", (q) =>
          q.eq("source", "x/y").eq("skillId", skillId),
        )
        .unique();
      untouchedIds.push([skillId, summary]);
      expect(summary!.needsDiscovery).toBe(false);
    }

    for (const id of [fail3, fail5]) {
      const skill = await ctx.db.get(id);
      expect(skill!.needsDiscovery).toBe(true);
      expect(skill!.discoveryFailCount).toBe(0);
    }

    const summary3 = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", "x/y").eq("skillId", "fail-3"),
      )
      .unique();
    expect(summary3!.needsDiscovery).toBe(true);
    expect(summary3!.discoveryFailCount).toBe(0);

    const summary5 = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", "x/y").eq("skillId", "fail-5"),
      )
      .unique();
    expect(summary5!.needsDiscovery).toBe(true);
    expect(summary5!.discoveryFailCount).toBe(0);
  });
});
