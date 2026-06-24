/**
 * Tests for duplicate / rename detection (convex/duplicates.ts):
 *
 *   - getSkillCopies groups aliases (same repo id + slug, different source)
 *     and flags the live one
 *   - renamedTo only surfaces when the live skill actually exists in our DB
 *     (regression for the code-review issue: a synthesized link to a never-
 *     synced live repo, or a slug changed on rename, would 404)
 *   - getSkillCopies groups forks (same content hash, different repo id) and
 *     refuses to classify unresolved / no-id rows as forks
 *   - computeCopyCounts denormalizes copyCount = aliases + forks
 */
import { vi, test, expect, beforeEach } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { MutationCtx } from "../convex/_generated/server";
import { makeTest } from "./_setup";

// Isolate shared state between tests: clear the github mock's call history (so
// not.toHaveBeenCalled is reliable) and ensure timers start real (the tests that
// need fake timers opt in explicitly). Prevents cross-test leakage.
beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

// resolveRepoIdentity hits the GitHub API; stub it so the re-resolution test is
// deterministic. Only that one export is overridden (the rest of github.ts is
// used by skills.ts and must stay real). No other test in this file invokes it.
// vi.hoisted so the mock fn exists when the hoisted vi.mock factory runs.
const { mockResolveRepoIdentity } = vi.hoisted(() => ({
  mockResolveRepoIdentity: vi.fn(),
}));
vi.mock("../convex/lib/github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../convex/lib/github")>();
  return { ...actual, resolveRepoIdentity: mockResolveRepoIdentity };
});

// Minimal skill + summary pair. Only the duplicate-detection fields vary
// between cases; everything else is boilerplate the schema requires.
async function insertPair(
  ctx: MutationCtx,
  fields: {
    source: string;
    skillId: string;
    installs?: number;
    isDelisted?: boolean;
    githubRepoId?: number;
    repoLiveName?: string;
    syncHash?: string;
    copyCount?: number;
    needsRepoResolution?: boolean;
  },
) {
  const now = Date.now();
  const skillDocId = await ctx.db.insert("skills", {
    source: fields.source,
    skillId: fields.skillId,
    name: fields.skillId,
    installs: fields.installs ?? 100,
    leaderboard: "all-time",
    lastSynced: now,
    lastSeenInApi: now,
    isDelisted: fields.isDelisted ?? false,
  });
  await ctx.db.insert("skillSummaries", {
    source: fields.source,
    skillId: fields.skillId,
    name: fields.skillId,
    installs: fields.installs ?? 100,
    lastSeenInApi: now,
    skillDocId,
    isDelisted: fields.isDelisted ?? false,
    githubRepoId: fields.githubRepoId,
    repoLiveName: fields.repoLiveName,
    syncHash: fields.syncHash,
    copyCount: fields.copyCount,
    needsRepoResolution: fields.needsRepoResolution,
  });
  return skillDocId;
}

test("aliases: groups same repo id + slug under different sources, flags the live one", async () => {
  const t = makeTest();

  // A repo renamed owner/old -> owner/new. Both names exist in our DB, share
  // the stable repo id (42) and the slug. The live name is owner/new.
  await t.run(async (ctx) => {
    await insertPair(ctx, {
      source: "owner/old",
      skillId: "do-thing",
      installs: 320000, // dead alias still carries an inflated count
      githubRepoId: 42,
      repoLiveName: "owner/new",
    });
    await insertPair(ctx, {
      source: "owner/new",
      skillId: "do-thing",
      installs: 12,
      githubRepoId: 42,
      repoLiveName: "owner/new",
    });
  });

  // Viewed from the dead alias: the live row is its alias, and renamedTo points
  // at it.
  const fromDead = await t.query(api.duplicates.getSkillCopies, {
    source: "owner/old",
    skillId: "do-thing",
  });
  expect(fromDead.aliases).toHaveLength(1);
  expect(fromDead.aliases[0]).toMatchObject({
    source: "owner/new",
    skillId: "do-thing",
    isLive: true,
  });
  expect(fromDead.renamedTo).toEqual({ source: "owner/new", skillId: "do-thing" });
  expect(fromDead.forks).toEqual([]);

  // Viewed from the live row: the dead alias is its alias, and it is NOT a
  // rename of anything (renamedTo null).
  const fromLive = await t.query(api.duplicates.getSkillCopies, {
    source: "owner/new",
    skillId: "do-thing",
  });
  expect(fromLive.aliases).toHaveLength(1);
  expect(fromLive.aliases[0]).toMatchObject({ source: "owner/old", isLive: false });
  expect(fromLive.renamedTo).toBeNull();
});

test("renamedTo is null when the live skill row is absent (no 404 link)", async () => {
  const t = makeTest();

  // Only the dead alias exists — the live repo (owner/new) was never synced.
  // Synthesizing a link from repoLiveName alone would 404, so renamedTo must
  // stay null.
  await t.run(async (ctx) => {
    await insertPair(ctx, {
      source: "owner/old",
      skillId: "do-thing",
      githubRepoId: 42,
      repoLiveName: "owner/new",
    });
  });

  const copies = await t.query(api.duplicates.getSkillCopies, {
    source: "owner/old",
    skillId: "do-thing",
  });
  expect(copies.aliases).toEqual([]);
  expect(copies.renamedTo).toBeNull();
});

test("renamedTo is null when the live row exists but is delisted", async () => {
  const t = makeTest();

  await t.run(async (ctx) => {
    await insertPair(ctx, {
      source: "owner/old",
      skillId: "do-thing",
      githubRepoId: 42,
      repoLiveName: "owner/new",
    });
    await insertPair(ctx, {
      source: "owner/new",
      skillId: "do-thing",
      isDelisted: true, // live row hidden -> not a valid link target
      githubRepoId: 42,
      repoLiveName: "owner/new",
    });
  });

  const copies = await t.query(api.duplicates.getSkillCopies, {
    source: "owner/old",
    skillId: "do-thing",
  });
  expect(copies.aliases).toEqual([]); // delisted rows are filtered out
  expect(copies.renamedTo).toBeNull();
});

test("forks: groups same content hash across different repo ids", async () => {
  const t = makeTest();

  // Two genuinely separate repos with identical SKILL.md content (same hash),
  // plus an unresolved row sharing the hash that must NOT be classified yet.
  await t.run(async (ctx) => {
    await insertPair(ctx, {
      source: "alice/skills",
      skillId: "shared",
      githubRepoId: 1,
      repoLiveName: "alice/skills",
      syncHash: "hash-abc",
    });
    await insertPair(ctx, {
      source: "bob/skills",
      skillId: "shared",
      githubRepoId: 2,
      repoLiveName: "bob/skills",
      syncHash: "hash-abc",
    });
    // Same hash but not yet resolved (githubRepoId undefined) — can't be
    // classified as a fork without a real, different repo id.
    await insertPair(ctx, {
      source: "carol/skills",
      skillId: "shared",
      syncHash: "hash-abc",
    });
  });

  const copies = await t.query(api.duplicates.getSkillCopies, {
    source: "alice/skills",
    skillId: "shared",
  });
  expect(copies.forks).toHaveLength(1);
  expect(copies.forks[0]).toMatchObject({ source: "bob/skills", skillId: "shared" });
  expect(copies.aliases).toEqual([]); // different repo ids, so not aliases
  expect(copies.renamedTo).toBeNull();
});

test("re-resolution: a repo renamed after stamping flips its old name to a dead alias", async () => {
  const t = makeTest();

  // State BEFORE the rename: owner/old was resolved while still live, so its
  // resolution row + summary both say repoLiveName = owner/old (looks live).
  // resolvedAt is 0 (ancient) so it's past the TTL and due for re-resolution.
  await t.run(async (ctx) => {
    await ctx.db.insert("githubRepoResolution", {
      repo: "owner/old",
      repoId: 42,
      liveName: "owner/old",
      resolvedAt: 0,
    });
    await insertPair(ctx, {
      source: "owner/old",
      skillId: "do-thing",
      githubRepoId: 42,
      repoLiveName: "owner/old",
    });
  });

  // GitHub now reports the repo renamed: same id, new full_name.
  mockResolveRepoIdentity.mockResolvedValue({
    status: "ok",
    repoId: 42,
    liveName: "owner/new",
  });

  // Fake timers swallow the chained computeCopyCounts schedule (same trade-off
  // as curated-sync.test.ts) — the re-stamp it would recompute over is already
  // asserted directly below.
  vi.useFakeTimers();
  try {
    const res = await t.action(internal.duplicates.reresolveStaleRepoIdentities, {});
    expect(res.changed).toBe(1);
  } finally {
    vi.useRealTimers();
  }

  await t.run(async (ctx) => {
    // The summary's repoLiveName now differs from its source -> reconcile will
    // recognize it as a dead alias and stop keeping it alive.
    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", "owner/old").eq("skillId", "do-thing"),
      )
      .unique();
    expect(summary!.repoLiveName).toBe("owner/new");

    // The resolution cache row is updated + its resolvedAt bumped past the TTL.
    const resolution = await ctx.db
      .query("githubRepoResolution")
      .withIndex("by_repo", (q) => q.eq("repo", "owner/old"))
      .unique();
    expect(resolution!.liveName).toBe("owner/new");
    expect(resolution!.resolvedAt).toBeGreaterThan(0);
  });
});

test("re-resolution: an unchanged repo bumps resolvedAt without re-stamping", async () => {
  const t = makeTest();

  await t.run(async (ctx) => {
    await ctx.db.insert("githubRepoResolution", {
      repo: "owner/live",
      repoId: 7,
      liveName: "owner/live",
      resolvedAt: 0,
    });
    await insertPair(ctx, {
      source: "owner/live",
      skillId: "do-thing",
      githubRepoId: 7,
      repoLiveName: "owner/live",
    });
  });

  // Still live, no rename.
  mockResolveRepoIdentity.mockResolvedValue({
    status: "ok",
    repoId: 7,
    liveName: "owner/live",
  });

  vi.useFakeTimers();
  try {
    const res = await t.action(internal.duplicates.reresolveStaleRepoIdentities, {});
    expect(res.changed).toBe(0);
  } finally {
    vi.useRealTimers();
  }

  await t.run(async (ctx) => {
    const resolution = await ctx.db
      .query("githubRepoResolution")
      .withIndex("by_repo", (q) => q.eq("repo", "owner/live"))
      .unique();
    // resolvedAt advanced so it won't be re-checked until the next TTL window.
    expect(resolution!.resolvedAt).toBeGreaterThan(0);
    expect(resolution!.liveName).toBe("owner/live");
  });
});

test("delist clears needsRepoResolution; relist re-sets it for a GitHub row", async () => {
  const t = makeTest();

  // A never-resolved GitHub row (in the resolve work-set).
  await t.run(async (ctx) => {
    await insertPair(ctx, {
      source: "owner/repo",
      skillId: "s",
      needsRepoResolution: true,
    });
  });
  const summaryId = await t.run(async (ctx) => {
    const row = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", "owner/repo").eq("skillId", "s"),
      )
      .unique();
    return row!._id;
  });

  // Delist → drops out of the work-set.
  await t.mutation(internal.skills.delistSkillsBatch, {
    entries: [{ summaryId, source: "owner/repo", skillId: "s" }],
  });
  const afterDelist = await t.run(async (ctx) => {
    const row = await ctx.db.get(summaryId);
    return { isDelisted: row!.isDelisted, needs: row!.needsRepoResolution };
  });
  expect(afterDelist.isDelisted).toBe(true);
  expect(afterDelist.needs).toBe(false);

  // Relist (reappears in a feed) → rejoins the work-set, or it'd stay unresolved.
  await t.mutation(internal.skills.upsertSkillsBatch, {
    skills: [
      { source: "owner/repo", skillId: "s", name: "s", installs: 100, isDuplicate: false },
    ],
    leaderboard: "all-time",
  });
  const afterRelist = await t.run(async (ctx) => {
    const row = await ctx.db.get(summaryId);
    return { isDelisted: row!.isDelisted, needs: row!.needsRepoResolution };
  });
  expect(afterRelist.isDelisted).toBe(false);
  expect(afterRelist.needs).toBe(true);
});

test("resolveRepoIdentities reuses a persisted resolution instead of re-hitting GitHub", async () => {
  const t = makeTest();

  await t.run(async (ctx) => {
    // A repo already in the resolution cache (e.g. resolved on an earlier page
    // of a prior iteration).
    await ctx.db.insert("githubRepoResolution", {
      repo: "owner/repo",
      repoId: 5,
      liveName: "owner/repo",
      resolvedAt: 0,
    });
    // A still-unresolved summary for that same repo (githubRepoId undefined).
    await insertPair(ctx, {
      source: "owner/repo",
      skillId: "s",
      needsRepoResolution: true,
    });
  });

  // Fake timers swallow the chained computeCopyCounts schedule.
  vi.useFakeTimers();
  try {
    await t.action(internal.duplicates.resolveRepoIdentities, {});
  } finally {
    vi.useRealTimers();
  }

  // Cross-iteration dedup: the persisted resolution was loaded for this page, so
  // GitHub was never hit for this repo...
  expect(mockResolveRepoIdentity).not.toHaveBeenCalled();

  // ...and the summary was stamped from the cached resolution.
  const stamped = await t.run(async (ctx) => {
    const row = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", "owner/repo").eq("skillId", "s"),
      )
      .unique();
    return { repoId: row!.githubRepoId, liveName: row!.repoLiveName };
  });
  expect(stamped.repoId).toBe(5);
  expect(stamped.liveName).toBe("owner/repo");
});

test("computeCopyCounts denormalizes copyCount = aliases + forks", async () => {
  const t = makeTest();

  // owner/new has one alias (owner/old, same repo 42) and one fork
  // (other/repo, same hash, different repo id) -> copyCount 2.
  await t.run(async (ctx) => {
    await insertPair(ctx, {
      source: "owner/new",
      skillId: "do-thing",
      githubRepoId: 42,
      repoLiveName: "owner/new",
      syncHash: "hash-xyz",
    });
    await insertPair(ctx, {
      source: "owner/old",
      skillId: "do-thing",
      githubRepoId: 42,
      repoLiveName: "owner/new",
    });
    await insertPair(ctx, {
      source: "other/repo",
      skillId: "do-thing",
      githubRepoId: 99,
      repoLiveName: "other/repo",
      syncHash: "hash-xyz",
    });
  });

  // Fixture is well under one page, so a single batch finishes the whole pass.
  const res = await t.mutation(internal.duplicates.computeCopyCountBatch, {});
  expect(res.isDone).toBe(true);

  const copyCount = await t.run(async (ctx) => {
    const row = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", "owner/new").eq("skillId", "do-thing"),
      )
      .unique();
    return row!.copyCount;
  });
  expect(copyCount).toBe(2);
});
