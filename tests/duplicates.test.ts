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
import { test, expect } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { makeTest } from "./_setup";

// Minimal skill + summary pair. Only the duplicate-detection fields vary
// between cases; everything else is boilerplate the schema requires.
async function insertPair(
  ctx: any,
  fields: {
    source: string;
    skillId: string;
    installs?: number;
    isDelisted?: boolean;
    githubRepoId?: number;
    repoLiveName?: string;
    syncHash?: string;
    copyCount?: number;
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
