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
import type { Id } from "../convex/_generated/dataModel";
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
        installs: 10, // low install count — still ingested (no install floor)
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

    // Low-install row is now ingested too — we sync the full leaderboard with
    // no install floor (the old MIN_INSTALLS=50 filter was removed).
    const lowInstall = await ctx.db
      .query("skills")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", "example.com").eq("skillId", "below-min"),
      )
      .unique();
    expect(lowInstall).not.toBeNull();
    expect(lowInstall!.installs).toBe(10);
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
      lastSeenInApi: now,
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
      lastSeenInApi: now,
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
      lastSeenInApi: now,
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

  // Verify the fetcher was actually called, not just bypassed. `oidcToken` is
  // null because no skillsAuthToken row is seeded here, so this also pins the
  // key-only fallback path.
  expect(getSkillSyncData).toHaveBeenCalledWith(
    expect.objectContaining({ oidcToken: null }),
    "example.com",
    "needs-fetch",
  );
});

// ---------------------------------------------------------------------------
// Manual-add seeding and the immediate publish
//
// Both exist for the same failure: an add writes a row, the content chain fills
// it in seconds to minutes later, and anything rendered in between is a skill
// page with an install count and no SKILL.md — cached on cacheLife("weeks").
// ---------------------------------------------------------------------------

/** A row in the state an add leaves it: name + installs, nothing else. */
async function seedAddedRow(
  t: ReturnType<typeof makeTest>,
  opts: { leaderboard: string; skillId: string },
): Promise<Id<"skills">> {
  const now = Date.now();
  return await t.run(async (ctx) => {
    const id = await ctx.db.insert("skills", {
      source: "example.com",
      skillId: opts.skillId,
      name: "Just Added",
      installs: 7,
      leaderboard: opts.leaderboard,
      lastSynced: now,
      lastSeenInApi: now,
      isDelisted: false,
      needsContentFetch: true,
      needsDiscovery: false,
    });
    await ctx.db.insert("skillSummaries", {
      source: "example.com",
      skillId: opts.skillId,
      name: "Just Added",
      installs: 7,
      skillDocId: id,
      isDelisted: false,
      lastSeenInApi: now,
      needsContentFetch: true,
      needsDiscovery: false,
    });
    return id;
  });
}

test("seedAddedSkillContent fills an empty row and mirrors the description", async () => {
  const t = makeTest();
  const skillDocId = await seedAddedRow(t, {
    leaderboard: "manual",
    skillId: "just-added",
  });

  await t.mutation(internal.skills.seedAddedSkillContent, {
    source: "example.com",
    skillId: "just-added",
    description: "Seeded description",
    content: "Seeded body",
  });

  await t.run(async (ctx) => {
    const skill = await ctx.db.get(skillDocId);
    expect(skill!.description).toBe("Seeded description");
    expect(skill!.content).toBe("Seeded body");
    // The hash stays unset on purpose: skills.sh can be behind GitHub, so the
    // next real fetch must take its changed-path and overwrite this rather than
    // match a hash for a copy we may never have held.
    expect(skill!.syncHash).toBeUndefined();
    // Still queued. Seeding is a stopgap for the page, not a substitute for the
    // pipeline that owns the content.
    expect(skill!.needsContentFetch).toBe(true);

    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", "example.com").eq("skillId", "just-added"),
      )
      .unique();
    // Cards, search results and catalog lists read the summary, not the skill.
    expect(summary!.description).toBe("Seeded description");
  });
});

test("seedAddedSkillContent never overwrites content the pipeline already wrote", async () => {
  // Relist and adopt both route through the seed. Their rows can already carry
  // content fetched from GitHub, and older-but-real content beats a sideways
  // write from a second source that may be behind it.
  const t = makeTest();
  const skillDocId = await seedAddedRow(t, {
    leaderboard: "manual",
    skillId: "already-has-content",
  });
  await t.run(async (ctx) => {
    await ctx.db.patch(skillDocId, {
      description: "From GitHub",
      content: "GitHub body",
    });
  });

  await t.mutation(internal.skills.seedAddedSkillContent, {
    source: "example.com",
    skillId: "already-has-content",
    description: "From skills.sh",
    content: "skills.sh body",
  });

  await t.run(async (ctx) => {
    const skill = await ctx.db.get(skillDocId);
    expect(skill!.description).toBe("From GitHub");
    expect(skill!.content).toBe("GitHub body");
  });
});

/**
 * How many `publishSkillUpdate` jobs the content writes have enqueued.
 *
 * Read off the scheduler rather than off a returned flag, because the point of
 * the change these tests guard is WHERE the publish is scheduled from: inside
 * the write's own transaction, so it cannot be lost between the commit and a
 * follow-up step in the calling action.
 */
async function scheduledPublishes(t: ReturnType<typeof makeTest>) {
  return await t.run(async (ctx) => {
    const jobs = await ctx.db.system.query("_scheduled_functions").collect();
    return jobs.filter((j) => j.name.includes("publishSkillUpdate")).length;
  });
}

test("a user-added row's first content publishes from inside the write", async () => {
  // The daily pipeline publishes at the terminal of a catalog-wide drain, which
  // is far too late for someone who just added a skill and is looking at it.
  const t = makeTest();
  const skillDocId = await seedAddedRow(t, {
    leaderboard: "manual",
    skillId: "user-added",
  });

  await t.mutation(internal.skills.updateSkillFromDetail, {
    skillId: skillDocId,
    description: "Fetched description",
    content: "Fetched body",
    syncHash: "b".repeat(64),
  });
  expect(await scheduledPublishes(t)).toBe(1);

  // Only the FIRST content qualifies. Later edits to the same row are ordinary
  // pipeline work and ride the terminal ping like everything else.
  await t.mutation(internal.skills.updateSkillFromDetail, {
    skillId: skillDocId,
    description: "Edited description",
    content: "Edited body",
    syncHash: "c".repeat(64),
  });
  expect(await scheduledPublishes(t)).toBe(1);
});

test("a synced row's first content does not publish", async () => {
  // The gate that keeps the cost sane. Every publisher here expires the content
  // tag catalog-wide, and syncSkills inserts new rows daily — without the
  // user-added check this would fire tens of times each morning.
  const t = makeTest();
  const skillDocId = await seedAddedRow(t, {
    leaderboard: "all-time",
    skillId: "synced-row",
  });

  const outcome = await t.mutation(internal.skills.updateSkillFromDetail, {
    skillId: skillDocId,
    description: "Fetched description",
    content: "Fetched body",
    syncHash: "d".repeat(64),
  });
  expect(outcome.changed).toBe(true);
  expect(await scheduledPublishes(t)).toBe(0);
});

test("updateSkillMdUrls: settles a mixed batch in one transaction", async () => {
  // The reason this mutation takes an array. One discovery invocation covers up
  // to 500 rows of a single source and previously spent one transaction each.
  // A batch mixes found and not-found rows, so this asserts they do not bleed
  // into one another: `contentFetchedAt` and the fail-count are gated per row on
  // `!hasUrl`. `now` is deliberately ONE value for the transaction — and could
  // not vary anyway, since the Convex runtime pins `Date.now()` per execution —
  // so the gate is what keeps a found row unstamped, not the clock.
  const t = makeTest();
  const now = Date.now();

  const ids = await t.run(async (ctx) => {
    const out: Record<string, Id<"skills">> = {};
    for (const skillId of ["found-one", "missing-one", "found-two"]) {
      const id = await ctx.db.insert("skills", {
        source: "acme/skills",
        skillId,
        name: skillId,
        installs: 1,
        leaderboard: "curated",
        lastSynced: now,
        lastSeenInApi: now,
        isDelisted: false,
        needsDiscovery: true,
        needsContentFetch: false,
      });
      await ctx.db.insert("skillSummaries", {
        source: "acme/skills",
        skillId,
        name: skillId,
        installs: 1,
        lastSeenInApi: now,
        skillDocId: id,
        isDelisted: false,
        needsDiscovery: true,
        needsContentFetch: false,
      });
      out[skillId] = id;
    }
    return out;
  });

  await t.mutation(internal.skills.updateSkillMdUrls, {
    updates: [
      { docId: ids["found-one"], skillMdUrl: "https://raw.example/one" },
      { docId: ids["missing-one"], skillMdUrl: "" },
      { docId: ids["found-two"], skillMdUrl: "https://raw.example/two" },
    ],
  });

  await t.run(async (ctx) => {
    for (const skillId of ["found-one", "found-two"]) {
      const skill = await ctx.db.get(ids[skillId]);
      expect(skill!.needsDiscovery).toBe(false);
      expect(skill!.needsContentFetch).toBe(true);
      expect(skill!.hasContentFetchError).toBe(false);
      expect(skill!.discoveryFailCount).toBe(0);
      // Must NOT be stamped — that is the not-found row's marker.
      expect(skill!.contentFetchedAt).toBeUndefined();
    }
    const missing = await ctx.db.get(ids["missing-one"]);
    expect(missing!.skillMdUrl).toBe("");
    expect(missing!.hasContentFetchError).toBe(true);
    expect(missing!.discoveryFailCount).toBe(1);
    expect(missing!.contentFetchedAt).toBeGreaterThan(0);

    // Both tables move together, for every row in the batch.
    const summaries = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) => q.eq("source", "acme/skills"))
      .collect();
    expect(summaries).toHaveLength(3);
    expect(summaries.every((x) => x.needsDiscovery === false)).toBe(true);
    expect(
      summaries.filter((x) => x.hasSkillMdUrl === true).map((x) => x.skillId).sort(),
    ).toEqual(["found-one", "found-two"]);
  });
});

test("updateSkillMdUrls: discovery failure sets hasContentFetchError on both rows", async () => {
  const t = makeTest();

  // Pre-seed a GitHub-source row in the state it'd be in right after a
  // syncCurated Pass 0 insert: flagged for discovery, no URL yet, no error
  // flag. This mirrors the real-world Bitwarden case — a low-install
  // curated skill whose SKILL.md isn't actually present in the repo.
  const now = Date.now();
  const skillDocId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("skills", {
      source: "bitwarden/ai-plugins",
      skillId: "reviewing-incremental-changes",
      name: "Reviewing Incremental Changes",
      installs: 15,
      leaderboard: "curated",
      lastSynced: now,
      lastSeenInApi: now,
      isDelisted: false,
      needsDiscovery: true,
      needsContentFetch: false,
    });
    await ctx.db.insert("skillSummaries", {
      source: "bitwarden/ai-plugins",
      skillId: "reviewing-incremental-changes",
      name: "Reviewing Incremental Changes",
      installs: 15,
      lastSeenInApi: now,
      skillDocId: id,
      isDelisted: false,
      needsDiscovery: true,
      needsContentFetch: false,
    });
    return id;
  });

  // Simulate the failure-callback that discoverSkillMdUrls makes when the
  // GitHub Tree walk turns up no SKILL.md anywhere.
  await t.mutation(internal.skills.updateSkillMdUrls, {
    updates: [{ docId: skillDocId, skillMdUrl: "" }],
  });

  await t.run(async (ctx) => {
    const skill = await ctx.db.get(skillDocId);
    expect(skill!.hasContentFetchError).toBe(true);
    expect(skill!.skillMdUrl).toBe("");
    expect(skill!.discoveryFailCount).toBe(1);
    expect(skill!.needsDiscovery).toBe(false);
    expect(skill!.needsContentFetch).toBe(false);

    // Summary mirrors the flag — the home page reads from summaries, so
    // without this the "Install may fail" badge wouldn't render on cards.
    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q
          .eq("source", "bitwarden/ai-plugins")
          .eq("skillId", "reviewing-incremental-changes"),
      )
      .unique();
    expect(summary!.hasContentFetchError).toBe(true);
    expect(summary!.hasSkillMdUrl).toBe(false);
  });
});

test("updateSkillMdUrls: rediscovery success clears hasContentFetchError on both rows", async () => {
  const t = makeTest();

  // Pre-seed a row in the "previously failed" state: error flag set, no URL.
  // Mirrors a row that exhausted content-fetch and was re-flagged for
  // discovery, OR one that failed discovery on a prior run.
  const now = Date.now();
  const skillDocId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("skills", {
      source: "example/repo",
      skillId: "recovered",
      name: "Recovered",
      installs: 100,
      leaderboard: "all-time",
      lastSynced: now,
      lastSeenInApi: now,
      isDelisted: false,
      hasContentFetchError: true,
      skillMdUrl: "",
      discoveryFailCount: 1,
      needsDiscovery: true,
    });
    await ctx.db.insert("skillSummaries", {
      source: "example/repo",
      skillId: "recovered",
      name: "Recovered",
      installs: 100,
      lastSeenInApi: now,
      skillDocId: id,
      isDelisted: false,
      hasContentFetchError: true,
      skillMdUrl: "",
      hasSkillMdUrl: false,
      discoveryFailCount: 1,
      needsDiscovery: true,
    });
    return id;
  });

  // Upstream put the SKILL.md back; discoverSkillMdUrls now finds it.
  await t.mutation(internal.skills.updateSkillMdUrls, {
    updates: [
      {
        docId: skillDocId,
        skillMdUrl:
          "https://raw.githubusercontent.com/example/repo/main/SKILL.md",
      },
    ],
  });

  await t.run(async (ctx) => {
    const skill = await ctx.db.get(skillDocId);
    expect(skill!.hasContentFetchError).toBe(false);
    expect(skill!.skillMdUrl).toBe(
      "https://raw.githubusercontent.com/example/repo/main/SKILL.md",
    );
    expect(skill!.discoveryFailCount).toBe(0);
    expect(skill!.needsContentFetch).toBe(true);

    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", "example/repo").eq("skillId", "recovered"),
      )
      .unique();
    expect(summary!.hasContentFetchError).toBe(false);
    expect(summary!.hasSkillMdUrl).toBe(true);
  });
});
