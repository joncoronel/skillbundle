/**
 * Integration tests for convex/bundleEvents.ts:
 *
 *   recordCopy — increments bundleStats.copyCount for public bundles from
 *   any caller (including signed-out), but for private bundles only counts
 *   when the authenticated caller is the bundle's owner.
 */
import { test, expect, describe } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { makeTest } from "./_setup";

type TestHandle = ReturnType<typeof makeTest>;

async function seedUser(t: TestHandle, externalId = "user-1") {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      name: "Test User",
      email: `${externalId}@example.com`,
      externalId,
    });
  });
}

async function seedBundle(
  t: TestHandle,
  userId: Id<"users">,
  isPublic: boolean,
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("bundles", {
      userId,
      name: "Test bundle",
      urlId: `bundle-${Math.random().toString(36).slice(2, 8)}`,
      skills: [],
      isPublic,
      createdAt: now,
    });
  });
}

async function getStats(t: TestHandle, bundleId: Id<"bundles">) {
  return await t.run(async (ctx) => {
    return await ctx.db
      .query("bundleStats")
      .withIndex("by_bundleId", (q) => q.eq("bundleId", bundleId))
      .unique();
  });
}

describe("recordCopy", () => {
  test("public bundle, no stats row, no identity: creates stats row with copyCount 1", async () => {
    const t = makeTest();
    const userId = await seedUser(t, "owner");
    const bundleId = await seedBundle(t, userId, true);

    await t.mutation(api.bundleEvents.recordCopy, { bundleId });

    const stats = await getStats(t, bundleId);
    expect(stats).not.toBeNull();
    expect(stats!.copyCount).toBe(1);
    expect(stats!.isPublic).toBe(true);
  });

  test("public bundle, existing stats row: second call increments to 2 and bumps lastEventAt", async () => {
    const t = makeTest();
    const userId = await seedUser(t, "owner");
    const bundleId = await seedBundle(t, userId, true);

    await t.mutation(api.bundleEvents.recordCopy, { bundleId });
    const first = await getStats(t, bundleId);

    await t.mutation(api.bundleEvents.recordCopy, { bundleId });
    const second = await getStats(t, bundleId);

    expect(second!.copyCount).toBe(2);
    expect(second!.lastEventAt).toBeGreaterThanOrEqual(first!.lastEventAt);
  });

  test("private bundle, no identity, no stats row: no-op", async () => {
    const t = makeTest();
    const userId = await seedUser(t, "owner");
    const bundleId = await seedBundle(t, userId, false);

    await t.mutation(api.bundleEvents.recordCopy, { bundleId });

    const stats = await getStats(t, bundleId);
    expect(stats).toBeNull();
  });

  test("private bundle, authenticated non-owner: no-op", async () => {
    const t = makeTest();
    const ownerId = await seedUser(t, "owner");
    await seedUser(t, "other");
    const bundleId = await seedBundle(t, ownerId, false);

    const asOther = t.withIdentity({ subject: "other" });
    await asOther.mutation(api.bundleEvents.recordCopy, { bundleId });

    const stats = await getStats(t, bundleId);
    expect(stats).toBeNull();
  });

  test("private bundle, authenticated owner: creates stats row with copyCount 1", async () => {
    const t = makeTest();
    const ownerId = await seedUser(t, "owner");
    const bundleId = await seedBundle(t, ownerId, false);

    const asOwner = t.withIdentity({ subject: "owner" });
    await asOwner.mutation(api.bundleEvents.recordCopy, { bundleId });

    const stats = await getStats(t, bundleId);
    expect(stats).not.toBeNull();
    expect(stats!.copyCount).toBe(1);
    expect(stats!.isPublic).toBe(false);
  });

  test("private bundle with existing stats row, no identity: copyCount stays 5", async () => {
    const t = makeTest();
    const userId = await seedUser(t, "owner");
    const bundleId = await seedBundle(t, userId, false);
    await t.run(async (ctx) => {
      await ctx.db.insert("bundleStats", {
        bundleId,
        isPublic: false,
        copyCount: 5,
        forkCount: 0,
        starCount: 0,
        lastEventAt: Date.now(),
      });
    });

    await t.mutation(api.bundleEvents.recordCopy, { bundleId });

    const stats = await getStats(t, bundleId);
    expect(stats!.copyCount).toBe(5);
  });
});
