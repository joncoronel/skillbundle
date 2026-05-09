/**
 * Integration test: embedSkillsBatch.
 *
 * Pre-seeds skills flagged needsEmbedding=true, mocks the embeddings client
 * (no real Voyage AI calls), runs embedSkillsBatch, drains, and verifies:
 *   - skillEmbeddings rows inserted with the correct skillId reference
 *   - hasEmbedding flag set on skill + summary
 *   - needsEmbedding cleared
 *   - skillEmbeddingId back-reference written on the summary
 *
 * The embedding-too-long fallback path (per-skill retry, then minimal,
 * then mark-unembeddable) is its own pipeline branch with significant
 * complexity. Out of scope here — the happy path is what the daily cron
 * runs against the vast majority of skills.
 */
import { vi, test, expect, beforeEach } from "vitest";

beforeEach(() => {
  vi.clearAllMocks();
});
import { internal } from "../convex/_generated/api";
import { makeTest } from "./_setup";

vi.mock("../convex/lib/embeddings", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../convex/lib/embeddings")>();
  return {
    ...actual,
    embedTexts: vi.fn(),
  };
});

import { embedTexts, EMBEDDING_DIMENSIONS } from "../convex/lib/embeddings";

// Build a deterministic 512-dim vector. The actual values don't matter for
// what we're testing — only that the right shape lands in the DB.
function fakeVector(seed: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
    Math.sin(seed * 0.1 + i) * 0.01,
  );
}

test("embedSkillsBatch writes embeddings + flips needsEmbedding=false", async () => {
  const t = makeTest();

  // Two skills flagged for embedding.
  const skillIds = await t.run(async (ctx) => {
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const skillId = `skill-${i}`;
      const id = await ctx.db.insert("skills", {
        source: "example.com",
        skillId,
        name: `Skill ${i}`,
        description: `Description ${i}`,
        content: `Body content for skill ${i}`,
        installs: 100,
        leaderboard: "all-time",
        lastSynced: Date.now(),
        needsEmbedding: true,
      });
      await ctx.db.insert("skillSummaries", {
        source: "example.com",
        skillId,
        name: `Skill ${i}`,
        installs: 100,
        skillDocId: id,
        isDelisted: false,
        needsEmbedding: true,
      });
      ids.push(id);
    }
    return ids;
  });

  // Mock returns one vector per input, in the same order.
  vi.mocked(embedTexts).mockImplementation(async (inputs) =>
    inputs.map((_, i) => fakeVector(i)),
  );

  await t.action(internal.skills.embedSkillsBatch, {});
  await t.finishInProgressScheduledFunctions();

  // Verify each skill has an embedding row + flags flipped.
  await t.run(async (ctx) => {
    for (const id of skillIds) {
      const embeddingRow = await ctx.db
        .query("skillEmbeddings")
        .withIndex("by_skillId", (q) => q.eq("skillId", id))
        .unique();
      expect(embeddingRow).not.toBeNull();
      expect(embeddingRow!.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
      expect(embeddingRow!.isDelisted).toBe(false);

      const skill = await ctx.db.get(id);
      expect(skill!.needsEmbedding).toBe(false);
      // The summary should mirror the back-reference.
      const summary = await ctx.db
        .query("skillSummaries")
        .withIndex("by_skillDocId", (q) => q.eq("skillDocId", id))
        .unique();
      expect(summary!.hasEmbedding).toBe(true);
      expect(summary!.skillEmbeddingId).toBe(embeddingRow!._id);
      expect(summary!.embeddingMode).toBe("full");
    }
  });

  // Verify embedTexts was called once with both skills' inputs in one batch.
  expect(embedTexts).toHaveBeenCalledTimes(1);
});

test("embedSkillsBatch is a no-op when no skills are flagged", async () => {
  const t = makeTest();

  await t.run(async (ctx) => {
    // Insert a skill that's already embedded — should not be picked up.
    const id = await ctx.db.insert("skills", {
      source: "example.com",
      skillId: "already-embedded",
      name: "Already Embedded",
      installs: 100,
      leaderboard: "all-time",
      lastSynced: Date.now(),
      needsEmbedding: false,
    });
    await ctx.db.insert("skillSummaries", {
      source: "example.com",
      skillId: "already-embedded",
      name: "Already Embedded",
      installs: 100,
      skillDocId: id,
      isDelisted: false,
      needsEmbedding: false,
      hasEmbedding: true,
    });
  });

  await t.action(internal.skills.embedSkillsBatch, {});
  await t.finishInProgressScheduledFunctions();

  expect(embedTexts).not.toHaveBeenCalled();
});
