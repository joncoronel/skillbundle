/** tagSkillsBatch against a mocked Jev client. */
import { vi, test, expect, beforeEach, afterEach } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { makeTest } from "./_setup";
import type { CategoryKey } from "../convex/lib/categories";
import { CATEGORY_KEYS, CATEGORIES_VERSION } from "../convex/lib/categories";

vi.mock("../convex/lib/jev", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../convex/lib/jev")>();
  return {
    ...actual,
    categorizeSkill: vi.fn(),
    hasTypeSafeKey: vi.fn(() => true),
  };
});

import {
  categorizeSkill,
  hasTypeSafeKey,
  TaggingInputRejectedError,
} from "../convex/lib/jev";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hasTypeSafeKey).mockReturnValue(true);
});
afterEach(() => {
  vi.useRealTimers();
});

function scores(high: Partial<Record<CategoryKey, number>>) {
  return Object.fromEntries(
    CATEGORY_KEYS.map((k) => [k, high[k] ?? 0.05]),
  ) as Record<CategoryKey, number>;
}

async function seedSkill(
  t: ReturnType<typeof makeTest>,
  skillId: string,
  needsTagging: boolean,
): Promise<Id<"skills">> {
  return await t.run(async (ctx) => {
    const id = await ctx.db.insert("skills", {
      source: "example.com",
      skillId,
      name: skillId,
      description: `Description of ${skillId}`,
      content: `Body of ${skillId}`,
      installs: 100,
      leaderboard: "all-time",
      lastSynced: Date.now(),
      isDelisted: false,
      needsTagging,
    });
    await ctx.db.insert("skillSummaries", {
      source: "example.com",
      skillId,
      name: skillId,
      installs: 100,
      skillDocId: id,
      isDelisted: false,
      lastSeenInApi: Date.now(),
    });
    return id;
  });
}

async function summaryTags(t: ReturnType<typeof makeTest>, id: Id<"skills">) {
  return await t.run(async (ctx) => {
    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_skillDocId", (q) => q.eq("skillDocId", id))
      .unique();
    return summary!.tags;
  });
}

test("tagSkillsBatch writes tags to the skill and its summary", async () => {
  const t = makeTest();
  const testingSkill = await seedSkill(t, "playwright-e2e", true);
  const deploySkill = await seedSkill(t, "deploy-helper", true);

  vi.mocked(categorizeSkill).mockImplementation(async ({ name }) =>
    name === "playwright-e2e"
      ? {
          scores: scores({ testing: 0.95, browser: 0.72, frontend: 0.55 }),
          primary: "testing",
          primaryConfidence: 0.9,
          model: "jev-1.13.0",
        }
      : {
          scores: scores({ cloud: 0.2 }),
          primary: "cloud",
          primaryConfidence: 0.8,
          model: "jev-1.13.0",
        },
  );

  await t.action(internal.tags.tagSkillsBatch, {});
  await t.finishInProgressScheduledFunctions();

  await t.run(async (ctx) => {
    const skill = await ctx.db.get(testingSkill);
    expect(skill!.needsTagging).toBe(false);
    // frontend's 0.55 is under the extra-tag cutoff.
    expect(skill!.tags).toEqual(["testing", "browser"]);
    expect(skill!.tagScores!.testing).toBe(0.95);
    expect(skill!.primaryCategory).toBe("testing");
    expect(skill!.tagsModel).toBe("jev-1.13.0");
    expect(skill!.tagsVersion).toBe(CATEGORIES_VERSION);
  });
  expect(await summaryTags(t, testingSkill)).toEqual(["testing", "browser"]);
  // The main category is tagged even though its own yes/no scored low.
  expect(await summaryTags(t, deploySkill)).toEqual(["cloud"]);
  expect(categorizeSkill).toHaveBeenCalledTimes(2);
});

test("a skill Jev rejects is parked, not retried, and the rest still tag", async () => {
  const t = makeTest();
  const bad = await seedSkill(t, "bad-input", true);
  const good = await seedSkill(t, "good-input", true);

  vi.mocked(categorizeSkill).mockImplementation(async ({ name }) => {
    if (name === "bad-input") throw new TaggingInputRejectedError("422");
    return {
      scores: scores({ docs: 0.9 }),
      primary: "docs",
      primaryConfidence: 0.9,
      model: "jev-1.13.0",
    };
  });

  await t.action(internal.tags.tagSkillsBatch, {});
  await t.finishInProgressScheduledFunctions();

  await t.run(async (ctx) => {
    const badRow = await ctx.db.get(bad);
    expect(badRow!.needsTagging).toBe(false);
    expect(badRow!.tagSkipReason).toBe("input_rejected");
    expect(badRow!.tags).toBeUndefined();
  });
  expect(await summaryTags(t, good)).toEqual(["docs"]);
});

test("a transient failure keeps the skill flagged for the next run", async () => {
  const t = makeTest();
  const id = await seedSkill(t, "flaky", true);

  vi.mocked(categorizeSkill).mockRejectedValue(new Error("network down"));

  await t.action(internal.tags.tagSkillsBatch, {});
  await t.finishInProgressScheduledFunctions();

  await t.run(async (ctx) => {
    const row = await ctx.db.get(id);
    expect(row!.needsTagging).toBe(true);
    expect(row!.tagSkipReason).toBeUndefined();
  });
});

test("one failing skill doesn't stop the rest of the batch or the chain", async () => {
  const t = makeTest();
  const flaky = await seedSkill(t, "flaky", true);
  const fine = await seedSkill(t, "fine", true);

  vi.mocked(categorizeSkill).mockImplementation(async ({ name }) => {
    if (name === "flaky") throw new Error("timeout");
    return {
      scores: scores({ security: 0.9 }),
      primary: "security",
      primaryConfidence: 0.9,
      model: "jev-1.13.0",
    };
  });

  await t.action(internal.tags.tagSkillsBatch, {});
  await t.finishInProgressScheduledFunctions();

  expect(await summaryTags(t, fine)).toEqual(["security"]);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(flaky))!.needsTagging).toBe(true);
  });
});

test("content that changes while Jev answers stays flagged", async () => {
  const t = makeTest();
  const id = await seedSkill(t, "moving", true);

  vi.mocked(categorizeSkill).mockImplementation(async () => {
    // A content fetch lands between the read and the write.
    await t.run((ctx) => ctx.db.patch(id, { contentUpdatedAt: 123 }));
    return {
      scores: scores({ docs: 0.9 }),
      primary: "docs",
      primaryConfidence: 0.9,
      model: "jev-1.13.0",
    };
  });

  // No drain: the chain would pick the still-set flag up again.
  await t.action(internal.tags.tagSkillsBatch, {});

  await t.run(async (ctx) => {
    const row = await ctx.db.get(id);
    expect(row!.tags).toEqual(["docs"]);
    expect(row!.needsTagging).toBe(true);
  });
});

test("a rejected skill whose content changed mid-request stays flagged", async () => {
  const t = makeTest();
  const id = await seedSkill(t, "moving-rejected", true);

  vi.mocked(categorizeSkill).mockImplementation(async () => {
    await t.run((ctx) => ctx.db.patch(id, { contentUpdatedAt: 456 }));
    throw new TaggingInputRejectedError("422");
  });

  await t.action(internal.tags.tagSkillsBatch, {});

  await t.run(async (ctx) => {
    const row = await ctx.db.get(id);
    expect(row!.tagSkipReason).toBe("input_rejected");
    expect(row!.needsTagging).toBe(true);
  });
});

test("tagSkillsBatch does nothing without an API key", async () => {
  const t = makeTest();
  const id = await seedSkill(t, "unkeyed", true);
  vi.mocked(hasTypeSafeKey).mockReturnValue(false);

  await t.action(internal.tags.tagSkillsBatch, {});
  await t.finishInProgressScheduledFunctions();

  expect(categorizeSkill).not.toHaveBeenCalled();
  await t.run(async (ctx) => {
    expect((await ctx.db.get(id))!.needsTagging).toBe(true);
  });
});

test("markAllForTagging flags live skills and starts the chain", async () => {
  const t = makeTest();
  const live = await seedSkill(t, "live", false);
  const delisted = await t.run(async (ctx) =>
    ctx.db.insert("skills", {
      source: "example.com",
      skillId: "gone",
      name: "gone",
      installs: 0,
      leaderboard: "all-time",
      lastSynced: Date.now(),
      isDelisted: true,
    }),
  );
  vi.mocked(categorizeSkill).mockResolvedValue({
    scores: scores({ planning: 0.9 }),
    primary: "planning",
    primaryConfidence: 0.9,
    model: "jev-1.13.0",
  });

  // Fake timers let finishAllScheduledFunctions run the 0ms chain.
  vi.useFakeTimers();
  await t.mutation(internal.tags.markAllForTagging, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(await summaryTags(t, live)).toEqual(["planning"]);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(delisted))!.needsTagging).toBeUndefined();
  });
});
