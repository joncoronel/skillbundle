/**
 * Invariant tests for the GitHub-only add quota and the add-flow throttle —
 * the billing-adjacent rules behind the public add feature:
 *
 *   1. The atomic gate in upsertSkillsBatch blocks the (limit+1)th genuine
 *      GitHub-only insert for a capped user.
 *   2. Relists bypass the gate (they consume no quota) and preserve the
 *      original adder's attribution.
 *   3. Adoption (a skills.sh feed reporting the skill) clears isGitHubOnly
 *      but does NOT free a quota slot: the immutable leaderboard tag keeps
 *      counting, so the quota is a stable lifetime allowance.
 *   4. Without enforceGitHubQuotaFor (admin / Pro callers) there is no cap.
 *   5. The fixed-window throttle rejects the 31st call in an hour and
 *      resets after the window elapses.
 *
 * Exercised at the mutation layer (upsertSkillsBatch / bumpAddSkillThrottle)
 * rather than through the public actions: the actions' GitHub/skills.sh
 * resolution is network I/O the invariants don't depend on, and the gate
 * deliberately lives in the mutation so it shares the insert's transaction.
 */
import { vi, test, expect, afterEach } from "vitest";
import { internal } from "../convex/_generated/api";
import { makeTest } from "./_setup";
import type { Id } from "../convex/_generated/dataModel";

afterEach(() => {
  vi.useRealTimers();
});

const LIMIT = 3;

async function seedUser(
  t: ReturnType<typeof makeTest>,
  externalId = "user_test",
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      name: "Test User",
      externalId,
    });
  });
}

/** One GitHub-only insert the way addGitHubCore issues it. */
function gitHubOnlyAdd(n: number, userId: Id<"users">, enforce: boolean) {
  return {
    skills: [
      {
        source: `acme/repo-${n}`,
        skillId: `skill-${n}`,
        name: `Skill ${n}`,
        installs: 0,
        isDuplicate: false,
      },
    ],
    leaderboard: "github",
    isGitHubOnly: true,
    ownsInstalls: false,
    addedBy: userId,
    ...(enforce && {
      enforceGitHubQuotaFor: { userId, limit: LIMIT },
    }),
  };
}

test("quota gate: 3 genuine GitHub-only inserts pass, the 4th throws quota_exceeded", async () => {
  const t = makeTest();
  const userId = await seedUser(t);

  for (let n = 1; n <= LIMIT; n++) {
    await t.mutation(
      internal.skills.upsertSkillsBatch,
      gitHubOnlyAdd(n, userId, true),
    );
  }

  await expect(
    t.mutation(
      internal.skills.upsertSkillsBatch,
      gitHubOnlyAdd(LIMIT + 1, userId, true),
    ),
  ).rejects.toMatchObject({ data: { code: "quota_exceeded" } });

  // The rejected insert wrote nothing.
  await t.run(async (ctx) => {
    const overflow = await ctx.db
      .query("skills")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", `acme/repo-${LIMIT + 1}`).eq("skillId", `skill-${LIMIT + 1}`),
      )
      .unique();
    expect(overflow).toBeNull();
  });
});

test("relist bypasses the gate at limit and preserves the original adder", async () => {
  const t = makeTest();
  const userId = await seedUser(t);
  const otherUser = await seedUser(t, "user_other");

  for (let n = 1; n <= LIMIT; n++) {
    await t.mutation(
      internal.skills.upsertSkillsBatch,
      gitHubOnlyAdd(n, userId, true),
    );
  }

  // Delist row 1 (both the skill row and its summary, as markDelistedSkills
  // would).
  await t.run(async (ctx) => {
    const skill = await ctx.db
      .query("skills")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", "acme/repo-1").eq("skillId", "skill-1"),
      )
      .unique();
    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", "acme/repo-1").eq("skillId", "skill-1"),
      )
      .unique();
    await ctx.db.patch(skill!._id, { isDelisted: true });
    await ctx.db.patch(summary!._id, { isDelisted: true });
  });

  // A DIFFERENT at-limit user relists it: the gate must not fire (the row
  // already exists — no genuine insert), and attribution must stay with the
  // original adder.
  await t.mutation(internal.skills.upsertSkillsBatch, {
    ...gitHubOnlyAdd(1, otherUser, true),
    enforceGitHubQuotaFor: { userId: otherUser, limit: 0 }, // fully capped
  });

  await t.run(async (ctx) => {
    const skill = await ctx.db
      .query("skills")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", "acme/repo-1").eq("skillId", "skill-1"),
      )
      .unique();
    expect(skill!.isDelisted).toBe(false);
    expect(skill!.addedBy).toBe(userId); // not overwritten by the relister
  });
});

test("adoption clears isGitHubOnly but never frees a quota slot", async () => {
  const t = makeTest();
  const userId = await seedUser(t);

  for (let n = 1; n <= LIMIT; n++) {
    await t.mutation(
      internal.skills.upsertSkillsBatch,
      gitHubOnlyAdd(n, userId, true),
    );
  }

  // A skills.sh feed reports row 1: the adoption transition. Feed defaults —
  // ownsInstalls true, isGitHubOnly unset (false).
  await t.mutation(internal.skills.upsertSkillsBatch, {
    skills: [
      {
        source: "acme/repo-1",
        skillId: "skill-1",
        name: "Skill 1",
        installs: 500,
        isDuplicate: false,
      },
    ],
    leaderboard: "all-time",
  });

  await t.run(async (ctx) => {
    const skill = await ctx.db
      .query("skills")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", "acme/repo-1").eq("skillId", "skill-1"),
      )
      .unique();
    // Marker cleared, real installs owned...
    expect(skill!.isGitHubOnly).toBe(false);
    expect(skill!.installs).toBe(500);
    // ...but the origin tag and attribution are immutable.
    expect(skill!.leaderboard).toBe("github");
    expect(skill!.addedBy).toBe(userId);
  });

  // The lifetime count still includes the adopted row: a new genuine insert
  // stays blocked.
  await expect(
    t.mutation(
      internal.skills.upsertSkillsBatch,
      gitHubOnlyAdd(LIMIT + 1, userId, true),
    ),
  ).rejects.toMatchObject({ data: { code: "quota_exceeded" } });
});

test("no enforceGitHubQuotaFor (admin / Pro) means no cap", async () => {
  const t = makeTest();
  const userId = await seedUser(t);

  for (let n = 1; n <= LIMIT + 2; n++) {
    await t.mutation(
      internal.skills.upsertSkillsBatch,
      gitHubOnlyAdd(n, userId, false),
    );
  }

  await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("skills")
      .withIndex("by_addedBy_leaderboard", (q) =>
        q.eq("addedBy", userId).eq("leaderboard", "github"),
      )
      .collect();
    expect(rows).toHaveLength(LIMIT + 2);
  });
});

test("throttle: 30 bumps pass, the 31st throws, and the window resets", async () => {
  // Fake only Date so convex-test's internal async machinery is untouched.
  vi.useFakeTimers({ toFake: ["Date"] });
  const t0 = new Date("2026-07-22T12:00:00Z");
  vi.setSystemTime(t0);

  const t = makeTest();
  const userId = await seedUser(t);

  for (let i = 0; i < 30; i++) {
    await t.mutation(internal.throttle.bumpAddSkillThrottle, { userId });
  }

  await expect(
    t.mutation(internal.throttle.bumpAddSkillThrottle, { userId }),
  ).rejects.toMatchObject({ data: { code: "rate_limited" } });

  // One hour later the fixed window resets and counting starts over.
  vi.setSystemTime(new Date(t0.getTime() + 60 * 60 * 1000));
  await t.mutation(internal.throttle.bumpAddSkillThrottle, { userId });

  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("userThrottles")
      .withIndex("by_user_key", (q) =>
        q.eq("userId", userId).eq("key", "add-skill"),
      )
      .unique();
    expect(row!.count).toBe(1);
  });
});
