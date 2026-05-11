/**
 * Tests for the curated sync (convex/curated.ts):
 *
 *   - Pass 0 inserts low-install curated skills that syncSkills would drop
 *   - Pass 0 fast-paths existing rows without clobbering leaderboard
 *   - Empty-API guard skips the sync entirely
 *   - Pass 2 clears curatedOwner from rows no longer in the curated set
 *
 * The first test is the regression test for the Bitwarden 404 bug — without
 * Pass 0, a low-install curated skill never lands in the DB and clicking the
 * publisher card on /official 404s.
 *
 * The leaderboard-preservation test is the regression test for the fix to the
 * code-review issue 1: upsertSkillsBatch must not patch `leaderboard` on the
 * existing-row path, otherwise an existing all-time row gets flipped to
 * "curated" whenever installs tick up between the 06:00 syncSkills and 06:30
 * syncCurated runs.
 */
import { vi, test, expect, beforeEach, afterEach } from "vitest";
import { internal } from "../convex/_generated/api";
import { makeTest } from "./_setup";

// Fake timers swallow the post-syncCurated schedule cascade in these tests.
// `syncCurated` ends with `ctx.scheduler.runAfter(0, backfillDiscoverUrls, {})`
// to drain the discovery + content-fetch chain. None of the assertions in this
// file depend on that chain running — they verify Pass 0/1/2/3 state, which is
// all in place before the schedule fires. With real timers, the scheduled
// function fires after the test transaction closes and crashes with
// "Transaction not started" (visible noise, not a failure). With fake timers
// that are never advanced, the schedule is queued and discarded on teardown.
//
// Intentional trade-off: this means a future regression where syncCurated
// *fails to schedule* the chain would not be caught here — it'd need a
// dedicated test (with fake timers + finishAllScheduledFunctions + chain
// mocks) elsewhere.
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

vi.mock("../convex/lib/skillsApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../convex/lib/skillsApi")>();
  return {
    ...actual,
    getCurated: vi.fn(),
  };
});

import { getCurated } from "../convex/lib/skillsApi";

function makeCuratedSkill(overrides: {
  source: string;
  slug: string;
  name: string;
  installs: number;
  sourceType?: "github" | "well-known";
}) {
  return {
    id: `${overrides.source}/${overrides.slug}`,
    slug: overrides.slug,
    name: overrides.name,
    source: overrides.source,
    installs: overrides.installs,
    sourceType: overrides.sourceType ?? ("github" as const),
    installUrl:
      overrides.sourceType === "well-known"
        ? `https://${overrides.source}/skills/${overrides.slug}`
        : `https://github.com/${overrides.source}`,
    url: `https://skills.sh/${overrides.source}/${overrides.slug}`,
  };
}

test("Pass 0: inserts low-install curated skill that syncSkills would drop", async () => {
  const t = makeTest();

  // Bitwarden-shaped fixture: a curated publisher whose only skill has way
  // fewer than MIN_INSTALLS (50). syncSkills wouldn't touch this — Pass 0 is
  // the only way it reaches the DB.
  vi.mocked(getCurated).mockResolvedValue({
    data: [
      {
        owner: "bitwarden",
        totalInstalls: 5,
        featuredRepo: "bitwarden",
        featuredSkill: "Password Vault",
        skills: [
          makeCuratedSkill({
            source: "bitwarden/sdk",
            slug: "password-vault",
            name: "Password Vault",
            installs: 5,
            sourceType: "github",
          }),
        ],
      },
    ],
    totalOwners: 1,
    totalSkills: 1,
    generatedAt: new Date().toISOString(),
  });

  await t.action(internal.curated.syncCurated, {});

  await t.run(async (ctx) => {
    const skill = await ctx.db
      .query("skills")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", "bitwarden/sdk").eq("skillId", "password-vault"),
      )
      .unique();
    expect(skill).not.toBeNull();
    expect(skill!.installs).toBe(5);
    // Slow-path insert flags for the full downstream pipeline. GitHub source
    // → discovery first, then content fetch.
    expect(skill!.needsDiscovery).toBe(true);
    expect(skill!.needsContentFetch).toBe(false);
    expect(skill!.needsEmbedding).toBe(true);
    expect(skill!.needsAudit).toBe(true);
    expect(skill!.isDelisted).toBe(false);
    // Origin tag — these rows were not on the all-time leaderboard.
    expect(skill!.leaderboard).toBe("curated");

    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", "bitwarden/sdk").eq("skillId", "password-vault"),
      )
      .unique();
    expect(summary).not.toBeNull();
    // Pass 1 ran after Pass 0 and stamped the curated owner.
    expect(summary!.curatedOwner).toBe("bitwarden");
    expect(skill!.curatedOwner).toBe("bitwarden");

    // Pass 3 built the rollup row that drives /official.
    const ownerRow = await ctx.db
      .query("curatedOwnerSummaries")
      .filter((q) => q.eq(q.field("owner"), "bitwarden"))
      .unique();
    expect(ownerRow).not.toBeNull();
    expect(ownerRow!.skillCount).toBe(1);
    expect(ownerRow!.repoCount).toBe(1);
  });
});

test("Pass 0: existing all-time row keeps its leaderboard when installs change", async () => {
  const t = makeTest();

  // Pre-seed: a row that originally came from syncSkills with leaderboard
  // "all-time" and installs 1000. Mirrors the 06:00 state of an active
  // curated skill that also has >MIN_INSTALLS, so it lives in both the
  // leaderboard and the curated set.
  const now = Date.now();
  const skillDocId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("skills", {
      source: "vercel-labs/agent-skills",
      skillId: "nextjs-development",
      name: "Next.js Development",
      installs: 1000,
      leaderboard: "all-time",
      lastSynced: now,
      lastSeenInApi: now,
      isDelisted: false,
      isDuplicate: false,
      needsDiscovery: false,
      needsContentFetch: false,
      needsEmbedding: false,
      needsAudit: false,
    });
    await ctx.db.insert("skillSummaries", {
      source: "vercel-labs/agent-skills",
      skillId: "nextjs-development",
      name: "Next.js Development",
      installs: 1000,
      lastSeenInApi: now,
      skillDocId: id,
      isDelisted: false,
      isDuplicate: false,
    });
    return id;
  });

  // syncCurated returns the same skill with a bumped install count — the
  // realistic 06:30 case where installs ticked up since 06:00 syncSkills.
  // Trips installsChanged → fast-path B in upsertSkillsBatch.
  vi.mocked(getCurated).mockResolvedValue({
    data: [
      {
        owner: "vercel-labs",
        totalInstalls: 1100,
        featuredRepo: "agent-skills",
        featuredSkill: "Next.js Development",
        skills: [
          makeCuratedSkill({
            source: "vercel-labs/agent-skills",
            slug: "nextjs-development",
            name: "Next.js Development",
            installs: 1100,
            sourceType: "github",
          }),
        ],
      },
    ],
    totalOwners: 1,
    totalSkills: 1,
    generatedAt: new Date().toISOString(),
  });

  await t.action(internal.curated.syncCurated, {});

  await t.run(async (ctx) => {
    const skill = await ctx.db.get(skillDocId);
    // Install count moved (so fast-path B fired) but leaderboard MUST NOT
    // be clobbered to "curated". This is the regression assertion for the
    // code-review fix.
    expect(skill!.installs).toBe(1100);
    expect(skill!.leaderboard).toBe("all-time");
    expect(skill!.curatedOwner).toBe("vercel-labs");
  });
});

test("empty curated response: no DB writes, existing stamps preserved", async () => {
  const t = makeTest();

  // Pre-seed an existing curated stamp. The defensive empty-response guard
  // must NOT clear this, otherwise a transient API blip wipes every
  // "Official" badge.
  const now = Date.now();
  await t.run(async (ctx) => {
    const id = await ctx.db.insert("skills", {
      source: "anthropics/skills",
      skillId: "agent-loop",
      name: "Agent Loop",
      installs: 500,
      leaderboard: "all-time",
      lastSynced: now,
      lastSeenInApi: now,
      isDelisted: false,
      curatedOwner: "anthropics",
    });
    await ctx.db.insert("skillSummaries", {
      source: "anthropics/skills",
      skillId: "agent-loop",
      name: "Agent Loop",
      installs: 500,
      lastSeenInApi: now,
      skillDocId: id,
      isDelisted: false,
      curatedOwner: "anthropics",
    });
    await ctx.db.insert("curatedOwnerSummaries", {
      owner: "anthropics",
      skillCount: 1,
      repoCount: 1,
    });
  });

  vi.mocked(getCurated).mockResolvedValue({
    data: [],
    totalOwners: 0,
    totalSkills: 0,
    generatedAt: new Date().toISOString(),
  });

  await t.action(internal.curated.syncCurated, {});

  await t.run(async (ctx) => {
    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", "anthropics/skills").eq("skillId", "agent-loop"),
      )
      .unique();
    expect(summary!.curatedOwner).toBe("anthropics");

    const ownerRow = await ctx.db
      .query("curatedOwnerSummaries")
      .filter((q) => q.eq(q.field("owner"), "anthropics"))
      .unique();
    expect(ownerRow).not.toBeNull();
  });
});

test("Pass 2: clears curatedOwner from rows no longer in the curated set", async () => {
  const t = makeTest();

  // Pre-seed: two stamped rows. Only one survives in the new curated set;
  // the other (`stale-owner`) must have its stamp cleared by Pass 2.
  const now = Date.now();
  await t.run(async (ctx) => {
    const survivorId = await ctx.db.insert("skills", {
      source: "vercel-labs/agent-skills",
      skillId: "nextjs-development",
      name: "Next.js Development",
      installs: 1000,
      leaderboard: "all-time",
      lastSynced: now,
      lastSeenInApi: now,
      isDelisted: false,
      curatedOwner: "vercel-labs",
    });
    await ctx.db.insert("skillSummaries", {
      source: "vercel-labs/agent-skills",
      skillId: "nextjs-development",
      name: "Next.js Development",
      installs: 1000,
      lastSeenInApi: now,
      skillDocId: survivorId,
      isDelisted: false,
      curatedOwner: "vercel-labs",
    });

    const staleId = await ctx.db.insert("skills", {
      source: "stale-owner/old-repo",
      skillId: "removed-skill",
      name: "Removed Skill",
      installs: 200,
      leaderboard: "all-time",
      lastSynced: now,
      lastSeenInApi: now,
      isDelisted: false,
      curatedOwner: "stale-owner",
    });
    await ctx.db.insert("skillSummaries", {
      source: "stale-owner/old-repo",
      skillId: "removed-skill",
      name: "Removed Skill",
      installs: 200,
      lastSeenInApi: now,
      skillDocId: staleId,
      isDelisted: false,
      curatedOwner: "stale-owner",
    });
  });

  // New curated response no longer includes stale-owner.
  vi.mocked(getCurated).mockResolvedValue({
    data: [
      {
        owner: "vercel-labs",
        totalInstalls: 1000,
        featuredRepo: "agent-skills",
        featuredSkill: "Next.js Development",
        skills: [
          makeCuratedSkill({
            source: "vercel-labs/agent-skills",
            slug: "nextjs-development",
            name: "Next.js Development",
            installs: 1000,
          }),
        ],
      },
    ],
    totalOwners: 1,
    totalSkills: 1,
    generatedAt: new Date().toISOString(),
  });

  await t.action(internal.curated.syncCurated, {});

  await t.run(async (ctx) => {
    const survivor = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q
          .eq("source", "vercel-labs/agent-skills")
          .eq("skillId", "nextjs-development"),
      )
      .unique();
    expect(survivor!.curatedOwner).toBe("vercel-labs");

    const stale = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", "stale-owner/old-repo").eq("skillId", "removed-skill"),
      )
      .unique();
    expect(stale!.curatedOwner).toBeUndefined();
    // The skill row's mirror field is cleared in lockstep.
    const staleSkill = await ctx.db.get(stale!.skillDocId);
    expect(staleSkill!.curatedOwner).toBeUndefined();
  });
});
