/**
 * Regression coverage for fetchSkillContent's exhausted-exception branch.
 *
 * Historically, an HTTP error (`!res.ok`) recorded a failure via
 * markContentFetchFailed, but a thrown fetch (DNS failure, connection
 * refused, TLS error, timeout) only logged to console and wrote nothing.
 * These tests assert the two paths now converge: a fetch that throws on
 * every retry attempt must record a failure exactly like an HTTP error
 * would, including the 2-consecutive-failures rediscovery reset.
 *
 * Pattern follows tests/skills-chain.test.ts.
 */
import { vi, test, expect, afterEach } from "vitest";
import { internal } from "../convex/_generated/api";
import { makeTest } from "./_setup";

afterEach(() => {
  vi.unstubAllGlobals();
});

const SKILL_MD_URL = "https://raw.githubusercontent.com/x/y/main/SKILL.md";

async function seedSkill(t: ReturnType<typeof makeTest>) {
  const now = Date.now();
  return t.run(async (ctx) => {
    const id = await ctx.db.insert("skills", {
      source: "x/y",
      skillId: "unreachable-skill",
      name: "Unreachable Skill",
      installs: 100,
      leaderboard: "all-time",
      lastSynced: now,
      lastSeenInApi: now,
      isDelisted: false,
      skillMdUrl: SKILL_MD_URL,
      needsContentFetch: true,
      needsDiscovery: false,
    });
    await ctx.db.insert("skillSummaries", {
      source: "x/y",
      skillId: "unreachable-skill",
      name: "Unreachable Skill",
      installs: 100,
      lastSeenInApi: now,
      skillDocId: id,
      isDelisted: false,
      skillMdUrl: SKILL_MD_URL,
      hasSkillMdUrl: true,
      needsContentFetch: true,
      needsDiscovery: false,
    });
    return id;
  });
}

test(
  "fetchSkillContent: a throwing fetch records a failure like an HTTP error",
  { timeout: 20000 },
  async () => {
    const t = makeTest();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );

    const skillId = await seedSkill(t);

    await t.action(internal.skills.fetchSkillContent, {
      skillId,
      skillMdUrl: SKILL_MD_URL,
      skillName: "Unreachable Skill",
    });

    await t.run(async (ctx) => {
      const skill = await ctx.db.get(skillId);
      expect(skill!.hasContentFetchError).toBe(true);
      expect(skill!.contentFetchFailCount).toBe(1);
      expect(skill!.needsContentFetch).toBe(false);

      const summary = await ctx.db
        .query("skillSummaries")
        .withIndex("by_source_skillId", (q) =>
          q.eq("source", "x/y").eq("skillId", "unreachable-skill"),
        )
        .unique();
      expect(summary!.hasContentFetchError).toBe(true);
    });
  },
);

test(
  "fetchSkillContent: two consecutive throw-failures trigger rediscovery",
  { timeout: 40000 },
  async () => {
    const t = makeTest();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );

    const skillId = await seedSkill(t);

    await t.action(internal.skills.fetchSkillContent, {
      skillId,
      skillMdUrl: SKILL_MD_URL,
      skillName: "Unreachable Skill",
    });

    // Second failure event: reset needsContentFetch so the action can run
    // again, mirroring how the sync chain would re-flag it.
    await t.run(async (ctx) => {
      await ctx.db.patch(skillId, { needsContentFetch: true });
    });

    await t.action(internal.skills.fetchSkillContent, {
      skillId,
      skillMdUrl: SKILL_MD_URL,
      skillName: "Unreachable Skill",
    });

    await t.run(async (ctx) => {
      const skill = await ctx.db.get(skillId);
      expect(skill!.needsDiscovery).toBe(true);
      expect(skill!.skillMdUrl).toBe("");
      expect(skill!.contentFetchFailCount).toBe(0);
    });
  },
);
