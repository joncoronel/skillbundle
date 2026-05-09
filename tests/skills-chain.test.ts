/**
 * Integration tests for the skill sync chain, exercised in segments:
 *
 *   syncSkills  →  upsertSkillsBatch       (test 1)
 *   markStaleContent                       (test 2)
 *   fetchSkillDetailBatch                  (test 3)
 *
 * Testing each segment in isolation rather than wiring the full
 * runAfter-based chain is intentional: convex-test's scheduler simulator
 * has known quirks around action-from-action delayed scheduling, and the
 * production chain timing isn't actually what we want to assert anyway.
 * What matters is that each segment correctly transforms its input
 * row state into the output state, which is exactly what these tests
 * verify.
 *
 * Walks the well-known source path so we don't need to mock the GitHub
 * Tree API or raw.githubusercontent.com — well-known goes through the v1
 * detail endpoint exclusively.
 */
import { vi, test, expect, beforeEach } from "vitest";
import { internal } from "../convex/_generated/api";
import { makeTest } from "./_setup";

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock("../convex/lib/skillsApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../convex/lib/skillsApi")>();
  return {
    ...actual,
    listSkills: vi.fn(),
    getSkillSyncData: vi.fn(),
  };
});

import { listSkills, getSkillSyncData } from "../convex/lib/skillsApi";

test("syncSkills + upsertSkillsBatch: well-known skill inserted with needsContentFetch=true", async () => {
  const t = makeTest();

  vi.mocked(listSkills).mockResolvedValue({
    data: [
      {
        id: "example.com/widget-skill",
        slug: "widget-skill",
        name: "Widget Skill",
        source: "example.com",
        installs: 1234,
        sourceType: "well-known",
        installUrl: "https://example.com/skills/widget",
        url: "https://skills.sh/example.com/widget-skill",
      },
      {
        id: "example.com/below-min",
        slug: "below-min",
        name: "Below Min",
        source: "example.com",
        installs: 10, // < MIN_INSTALLS, must be filtered out
        sourceType: "well-known",
        installUrl: "https://example.com/skills/below-min",
        url: "https://skills.sh/example.com/below-min",
      },
    ],
    pagination: { page: 0, perPage: 500, total: 2, hasMore: false },
  });

  // Just exercise the listing pass; the chain it kicks off (markStaleContent
  // → backfillDiscoverUrls → fetchSkillDetailBatch) is tested separately.
  await t.action(internal.skills.syncSkills, {});

  await t.run(async (ctx) => {
    const skill = await ctx.db
      .query("skills")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", "example.com").eq("skillId", "widget-skill"),
      )
      .unique();
    expect(skill).not.toBeNull();
    expect(skill!.installs).toBe(1234);
    // Well-known sources go through v1 detail directly (skipping discovery).
    expect(skill!.needsContentFetch).toBe(true);
    expect(skill!.needsDiscovery).toBe(false);

    // Below-threshold row was filtered out before insert.
    const filtered = await ctx.db
      .query("skills")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", "example.com").eq("skillId", "below-min"),
      )
      .unique();
    expect(filtered).toBeNull();
  });
});

test("markStaleContent leaves freshly-fetched rows alone", async () => {
  const t = makeTest();

  // Pre-seed a fully-populated, recently-fetched row. The 7-day staleness
  // check should leave it untouched.
  const now = Date.now();
  const skillDocId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("skills", {
      source: "example.com",
      skillId: "fresh-skill",
      name: "Fresh Skill",
      description: "Already fetched",
      content: "Body",
      installs: 500,
      leaderboard: "all-time",
      lastSynced: now,
      contentFetchedAt: now,
      syncHash: "b".repeat(64),
      needsContentFetch: false,
      needsDiscovery: false,
    });
    await ctx.db.insert("skillSummaries", {
      source: "example.com",
      skillId: "fresh-skill",
      name: "Fresh Skill",
      description: "Already fetched",
      installs: 500,
      skillDocId: id,
      isDelisted: false,
      contentFetchedAt: now,
      syncHash: "b".repeat(64),
      needsContentFetch: false,
      needsDiscovery: false,
    });
    return id;
  });

  await t.mutation(internal.skills.markStaleContentBatch, {});

  await t.run(async (ctx) => {
    const skill = await ctx.db.get(skillDocId);
    // Fresh row should not have been re-flagged.
    expect(skill!.needsContentFetch).toBe(false);
    expect(skill!.description).toBe("Already fetched");
    expect(skill!.syncHash).toBe("b".repeat(64));
  });
});

test("markStaleContent re-flags a row whose content is >7 days old", async () => {
  const t = makeTest();

  // Pre-seed a well-known row with contentFetchedAt 8 days ago.
  const now = Date.now();
  const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;
  const skillDocId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("skills", {
      source: "example.com",
      skillId: "stale-skill",
      name: "Stale Skill",
      description: "Old content",
      installs: 500,
      leaderboard: "all-time",
      lastSynced: eightDaysAgo,
      contentFetchedAt: eightDaysAgo,
      syncHash: "c".repeat(64),
      needsContentFetch: false,
      needsDiscovery: false,
    });
    await ctx.db.insert("skillSummaries", {
      source: "example.com",
      skillId: "stale-skill",
      name: "Stale Skill",
      description: "Old content",
      installs: 500,
      skillDocId: id,
      isDelisted: false,
      contentFetchedAt: eightDaysAgo,
      syncHash: "c".repeat(64),
      needsContentFetch: false,
      needsDiscovery: false,
    });
    return id;
  });

  await t.mutation(internal.skills.markStaleContentBatch, {});

  await t.run(async (ctx) => {
    const skill = await ctx.db.get(skillDocId);
    // Stale content → re-flagged for fetch.
    expect(skill!.needsContentFetch).toBe(true);
  });
});

test("fetchSkillDetailBatch consumes the queue and populates content", async () => {
  const t = makeTest();

  vi.mocked(getSkillSyncData).mockResolvedValue({
    hash: "a".repeat(64),
    skillMdContents:
      "---\nname: Widget Skill\ndescription: Helps with widgets\n---\n\n# Widget Skill\n\nUse this when working with widgets.",
  });

  // Pre-seed a well-known row flagged for content fetch (the state the
  // chain leaves after upsertSkillsBatch + markStaleContent for new rows).
  const now = Date.now();
  const skillDocId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("skills", {
      source: "example.com",
      skillId: "needs-fetch",
      name: "Needs Fetch",
      installs: 500,
      leaderboard: "all-time",
      lastSynced: now,
      needsContentFetch: true,
      needsDiscovery: false,
    });
    await ctx.db.insert("skillSummaries", {
      source: "example.com",
      skillId: "needs-fetch",
      name: "Needs Fetch",
      installs: 500,
      skillDocId: id,
      isDelisted: false,
      needsContentFetch: true,
      needsDiscovery: false,
    });
    return id;
  });

  await t.action(internal.skills.fetchSkillDetailBatch, {});
  // Drain self-rescheduled batches until the queue is empty.
  await t.finishInProgressScheduledFunctions();

  await t.run(async (ctx) => {
    const skill = await ctx.db.get(skillDocId);
    expect(skill!.description).toBe("Helps with widgets");
    expect(skill!.content).toContain("Use this when working with widgets");
    expect(skill!.syncHash).toBe("a".repeat(64));
    expect(skill!.needsContentFetch).toBe(false);
  });

  // Verify the fetcher was actually called, not just bypassed.
  expect(getSkillSyncData).toHaveBeenCalledWith("example.com", "needs-fetch");
});
