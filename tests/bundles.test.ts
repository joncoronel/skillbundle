/**
 * Integration tests for convex/bundles.ts mutations:
 *
 *   createBundle             — auth, plan limits, validation, defense-in-depth
 *   updateBundleSkills       — dedupe, addedAt preservation, cap, auth, missing-skill rejection
 *   updateBundleDescription  — trim, empty→undefined, length cap, auth
 *
 * `assertSkillsExist` is an internal helper used by both `createBundle` and
 * `updateBundleSkills`; it isn't exported, so we exercise it indirectly
 * through those two mutations. Coverage of the unknown-skill rejection
 * path on each surface is what matters — the helper's dedupe-then-query
 * shape is implementation detail.
 */
import { test, expect, describe } from "vitest";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { makeTest } from "./_setup";
import {
  MAX_BUNDLE_DESCRIPTION_LENGTH,
  MAX_BUNDLE_SKILLS,
} from "../lib/bundle-limits";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

async function seedSkill(t: TestHandle, source: string, skillId: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("skills", {
      source,
      skillId,
      name: `${source}/${skillId}`,
      installs: 100,
      leaderboard: "alltime",
      lastSynced: Date.now(),
    });
  });
}

async function seedSkills(
  t: TestHandle,
  skills: Array<{ source: string; skillId: string }>,
) {
  for (const s of skills) await seedSkill(t, s.source, s.skillId);
}

// Standard test setup: one user, three skills. Returns the test handle
// already scoped with that user's identity, plus the user's _id for
// direct-db assertions.
async function setup() {
  const t = makeTest();
  const userId = await seedUser(t, "user-1");
  await seedSkills(t, [
    { source: "owner/repo", skillId: "skill-a" },
    { source: "owner/repo", skillId: "skill-b" },
    { source: "owner/repo", skillId: "skill-c" },
  ]);
  const asUser = t.withIdentity({ subject: "user-1" });
  return { t, asUser, userId };
}

// ---------------------------------------------------------------------------
// createBundle
// ---------------------------------------------------------------------------

describe("createBundle", () => {
  test("inserts bundle with trimmed name + description, stamps addedAt and updatedAt", async () => {
    const { t, asUser, userId } = await setup();

    const before = Date.now();
    const { bundleId } = await asUser.mutation(api.bundles.createBundle, {
      name: "  My Bundle  ",
      description: "  A short description  ",
      skills: [
        { source: "owner/repo", skillId: "skill-a" },
        { source: "owner/repo", skillId: "skill-b" },
      ],
      isPublic: true,
    });
    const after = Date.now();

    const bundle = await t.run(async (ctx) => ctx.db.get(bundleId));
    expect(bundle).not.toBeNull();
    expect(bundle!.name).toBe("My Bundle");
    expect(bundle!.description).toBe("A short description");
    expect(bundle!.userId).toBe(userId);
    expect(bundle!.isPublic).toBe(true);
    expect(bundle!.createdAt).toBeGreaterThanOrEqual(before);
    expect(bundle!.createdAt).toBeLessThanOrEqual(after);
    expect(bundle!.updatedAt).toBe(bundle!.createdAt);
    expect(bundle!.skills).toHaveLength(2);
    for (const s of bundle!.skills) {
      expect(s.addedAt).toBe(bundle!.createdAt);
    }
  });

  test("empty/whitespace-only description is stored as undefined", async () => {
    const { t, asUser } = await setup();

    const { bundleId } = await asUser.mutation(api.bundles.createBundle, {
      name: "No description",
      description: "   ",
      skills: [{ source: "owner/repo", skillId: "skill-a" }],
      isPublic: true,
    });

    const bundle = await t.run(async (ctx) => ctx.db.get(bundleId));
    expect(bundle!.description).toBeUndefined();
  });

  test("omitting description leaves it undefined", async () => {
    const { t, asUser } = await setup();
    const { bundleId } = await asUser.mutation(api.bundles.createBundle, {
      name: "No description",
      skills: [{ source: "owner/repo", skillId: "skill-a" }],
      isPublic: true,
    });
    const bundle = await t.run(async (ctx) => ctx.db.get(bundleId));
    expect(bundle!.description).toBeUndefined();
  });

  test("rejects empty/whitespace-only name", async () => {
    const { asUser } = await setup();
    await expect(
      asUser.mutation(api.bundles.createBundle, {
        name: "   ",
        skills: [{ source: "owner/repo", skillId: "skill-a" }],
        isPublic: true,
      }),
    ).rejects.toThrow(/Name cannot be empty/i);
  });

  test("rejects description over the length cap", async () => {
    const { asUser } = await setup();
    await expect(
      asUser.mutation(api.bundles.createBundle, {
        name: "Too long description",
        description: "x".repeat(MAX_BUNDLE_DESCRIPTION_LENGTH + 1),
        skills: [{ source: "owner/repo", skillId: "skill-a" }],
        isPublic: true,
      }),
    ).rejects.toThrow(
      new RegExp(`Description must be ${MAX_BUNDLE_DESCRIPTION_LENGTH}`, "i"),
    );
  });

  test("accepts description exactly at the length cap", async () => {
    const { t, asUser } = await setup();
    const at = "x".repeat(MAX_BUNDLE_DESCRIPTION_LENGTH);
    const { bundleId } = await asUser.mutation(api.bundles.createBundle, {
      name: "At cap",
      description: at,
      skills: [{ source: "owner/repo", skillId: "skill-a" }],
      isPublic: true,
    });
    const bundle = await t.run(async (ctx) => ctx.db.get(bundleId));
    expect(bundle!.description).toBe(at);
  });

  test("rejects skill arrays over MAX_BUNDLE_SKILLS without touching the catalog", async () => {
    // No seeded skills for these IDs — if the cap check ran after
    // assertSkillsExist, we'd see "Unknown skills" instead. The cap must
    // fire first so a pathological payload doesn't get N parallel index
    // queries.
    const { asUser } = await setup();
    const bogusSkills = Array.from(
      { length: MAX_BUNDLE_SKILLS + 1 },
      (_, i) => ({ source: "bogus", skillId: `s-${i}` }),
    );
    await expect(
      asUser.mutation(api.bundles.createBundle, {
        name: "Too many",
        skills: bogusSkills,
        isPublic: true,
      }),
    ).rejects.toThrow(/limited to .* skills/i);
  });

  test("rejects unknown skill refs and lists them in the error", async () => {
    const { asUser } = await setup();
    await expect(
      asUser.mutation(api.bundles.createBundle, {
        name: "Ghost skills",
        skills: [
          { source: "owner/repo", skillId: "skill-a" }, // real
          { source: "owner/repo", skillId: "does-not-exist" }, // ghost
        ],
        isPublic: true,
      }),
    ).rejects.toThrow(/Unknown skill.*owner\/repo\/does-not-exist/i);
  });

  test("error sample is capped at 5 names with a '+N more' tail", async () => {
    const { asUser } = await setup();
    const ghosts = Array.from({ length: 8 }, (_, i) => ({
      source: "ghost",
      skillId: `g-${i}`,
    }));
    await expect(
      asUser.mutation(api.bundles.createBundle, {
        name: "Many ghosts",
        skills: ghosts,
        isPublic: true,
      }),
    ).rejects.toThrow(/\+3 more/);
  });

  test("rejects when the free user is at the bundle limit", async () => {
    // Free plan = 3 bundles. Insert 3 directly to hit the cap without
    // exercising the createBundle path 3 times.
    const { t, asUser, userId } = await setup();
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert("bundles", {
          userId,
          name: `Existing ${i}`,
          urlId: `existing-${i}`,
          skills: [],
          isPublic: true,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    await expect(
      asUser.mutation(api.bundles.createBundle, {
        name: "One too many",
        skills: [{ source: "owner/repo", skillId: "skill-a" }],
        isPublic: true,
      }),
    ).rejects.toThrow(/Bundle limit reached/i);
  });

  test("rejects when unauthenticated", async () => {
    const t = makeTest();
    await expect(
      t.mutation(api.bundles.createBundle, {
        name: "Anon",
        skills: [],
        isPublic: true,
      }),
    ).rejects.toThrow(/get current user/i);
  });

  test("rejects private bundle on free plan", async () => {
    const { asUser } = await setup();
    await expect(
      asUser.mutation(api.bundles.createBundle, {
        name: "Private",
        skills: [{ source: "owner/repo", skillId: "skill-a" }],
        isPublic: false,
      }),
    ).rejects.toThrow(/Private bundles require a Pro plan/i);
  });
});

// ---------------------------------------------------------------------------
// updateBundleSkills
// ---------------------------------------------------------------------------

describe("updateBundleSkills", () => {
  // Insert a bundle directly so we don't pay the createBundle validation
  // path for tests that are about the *update* mutation. Returns the
  // bundle id plus a known `addedAt` we can assert is preserved.
  async function seedBundle(
    t: TestHandle,
    userId: Id<"users">,
    skills: Array<{ source: string; skillId: string; addedAt: number }>,
  ) {
    return await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("bundles", {
        userId,
        name: "Existing",
        urlId: `seed-${Math.random().toString(36).slice(2, 8)}`,
        skills,
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  test("preserves addedAt on kept skills, stamps new addedAt on adds", async () => {
    const { t, asUser, userId } = await setup();
    const originalAddedAt = 1_000_000_000_000; // arbitrary fixed timestamp
    const bundleId = await seedBundle(t, userId, [
      { source: "owner/repo", skillId: "skill-a", addedAt: originalAddedAt },
    ]);

    const before = Date.now();
    await asUser.mutation(api.bundles.updateBundleSkills, {
      bundleId,
      skills: [
        { source: "owner/repo", skillId: "skill-a" }, // kept
        { source: "owner/repo", skillId: "skill-b" }, // added
      ],
    });
    const after = Date.now();

    const bundle = await t.run(async (ctx) => ctx.db.get(bundleId));
    expect(bundle!.skills).toHaveLength(2);
    const kept = bundle!.skills.find((s) => s.skillId === "skill-a");
    const added = bundle!.skills.find((s) => s.skillId === "skill-b");
    expect(kept!.addedAt).toBe(originalAddedAt);
    expect(added!.addedAt).toBeGreaterThanOrEqual(before);
    expect(added!.addedAt!).toBeLessThanOrEqual(after);
    expect(bundle!.updatedAt).toBeGreaterThanOrEqual(before);
    expect(bundle!.updatedAt!).toBeLessThanOrEqual(after);
  });

  test("dedupes by (source, skillId) keeping the first occurrence", async () => {
    const { t, asUser, userId } = await setup();
    const bundleId = await seedBundle(t, userId, []);

    await asUser.mutation(api.bundles.updateBundleSkills, {
      bundleId,
      skills: [
        { source: "owner/repo", skillId: "skill-a" },
        { source: "owner/repo", skillId: "skill-b" },
        { source: "owner/repo", skillId: "skill-a" }, // dupe
      ],
    });

    const bundle = await t.run(async (ctx) => ctx.db.get(bundleId));
    expect(bundle!.skills).toHaveLength(2);
    expect(bundle!.skills.map((s) => s.skillId)).toEqual([
      "skill-a",
      "skill-b",
    ]);
  });

  test("removes skills not in the new list", async () => {
    const { t, asUser, userId } = await setup();
    const now = Date.now();
    const bundleId = await seedBundle(t, userId, [
      { source: "owner/repo", skillId: "skill-a", addedAt: now },
      { source: "owner/repo", skillId: "skill-b", addedAt: now },
      { source: "owner/repo", skillId: "skill-c", addedAt: now },
    ]);

    await asUser.mutation(api.bundles.updateBundleSkills, {
      bundleId,
      skills: [{ source: "owner/repo", skillId: "skill-b" }],
    });

    const bundle = await t.run(async (ctx) => ctx.db.get(bundleId));
    expect(bundle!.skills).toHaveLength(1);
    expect(bundle!.skills[0].skillId).toBe("skill-b");
  });

  test("rejects skill arrays over MAX_BUNDLE_SKILLS", async () => {
    const { t, asUser, userId } = await setup();
    const bundleId = await seedBundle(t, userId, []);
    const bogus = Array.from({ length: MAX_BUNDLE_SKILLS + 1 }, (_, i) => ({
      source: "bogus",
      skillId: `s-${i}`,
    }));
    await expect(
      asUser.mutation(api.bundles.updateBundleSkills, {
        bundleId,
        skills: bogus,
      }),
    ).rejects.toThrow(/limited to .* skills/i);
  });

  test("rejects unknown skill refs", async () => {
    const { t, asUser, userId } = await setup();
    const bundleId = await seedBundle(t, userId, []);
    await expect(
      asUser.mutation(api.bundles.updateBundleSkills, {
        bundleId,
        skills: [{ source: "owner/repo", skillId: "does-not-exist" }],
      }),
    ).rejects.toThrow(/Unknown skill/i);
  });

  test("rejects when caller is not the bundle owner", async () => {
    const { t, userId } = await setup();
    const bundleId = await seedBundle(t, userId, []);
    // Second user — exists in DB, has a valid identity, but doesn't own
    // the bundle. The auth path returns the correct user, then the
    // ownership check fails.
    await seedUser(t, "user-2");
    const asOther = t.withIdentity({ subject: "user-2" });
    await expect(
      asOther.mutation(api.bundles.updateBundleSkills, {
        bundleId,
        skills: [{ source: "owner/repo", skillId: "skill-a" }],
      }),
    ).rejects.toThrow(/not found or unauthorized/i);
  });
});

// ---------------------------------------------------------------------------
// updateBundleDescription
// ---------------------------------------------------------------------------

describe("updateBundleDescription", () => {
  async function seedBundleWithDescription(
    t: TestHandle,
    userId: Id<"users">,
    description?: string,
  ) {
    return await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("bundles", {
        userId,
        name: "Existing",
        urlId: `desc-${Math.random().toString(36).slice(2, 8)}`,
        description,
        skills: [],
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  test("sets and trims the description", async () => {
    const { t, asUser, userId } = await setup();
    const bundleId = await seedBundleWithDescription(t, userId);

    await asUser.mutation(api.bundles.updateBundleDescription, {
      bundleId,
      description: "   hello world   ",
    });

    const bundle = await t.run(async (ctx) => ctx.db.get(bundleId));
    expect(bundle!.description).toBe("hello world");
  });

  test("empty/whitespace-only description clears the field to undefined", async () => {
    const { t, asUser, userId } = await setup();
    const bundleId = await seedBundleWithDescription(t, userId, "before");

    await asUser.mutation(api.bundles.updateBundleDescription, {
      bundleId,
      description: "   ",
    });

    const bundle = await t.run(async (ctx) => ctx.db.get(bundleId));
    expect(bundle!.description).toBeUndefined();
  });

  test("bumps updatedAt", async () => {
    const { t, asUser, userId } = await setup();
    const bundleId = await t.run(async (ctx) => {
      // Use a deliberately-old updatedAt so the post-update bump is
      // unambiguous regardless of test scheduler timing.
      return await ctx.db.insert("bundles", {
        userId,
        name: "Old",
        urlId: "old-stamp",
        skills: [],
        isPublic: true,
        createdAt: 1_000_000_000_000,
        updatedAt: 1_000_000_000_000,
      });
    });

    const before = Date.now();
    await asUser.mutation(api.bundles.updateBundleDescription, {
      bundleId,
      description: "new",
    });
    const bundle = await t.run(async (ctx) => ctx.db.get(bundleId));
    expect(bundle!.updatedAt).toBeGreaterThanOrEqual(before);
  });

  test("rejects description over the length cap", async () => {
    const { t, asUser, userId } = await setup();
    const bundleId = await seedBundleWithDescription(t, userId);
    await expect(
      asUser.mutation(api.bundles.updateBundleDescription, {
        bundleId,
        description: "x".repeat(MAX_BUNDLE_DESCRIPTION_LENGTH + 1),
      }),
    ).rejects.toThrow(
      new RegExp(`Description must be ${MAX_BUNDLE_DESCRIPTION_LENGTH}`, "i"),
    );
  });

  test("rejects when caller is not the bundle owner", async () => {
    const { t, userId } = await setup();
    const bundleId = await seedBundleWithDescription(t, userId);
    await seedUser(t, "user-2");
    const asOther = t.withIdentity({ subject: "user-2" });
    await expect(
      asOther.mutation(api.bundles.updateBundleDescription, {
        bundleId,
        description: "intruder",
      }),
    ).rejects.toThrow(/not found or unauthorized/i);
  });
});

// ---------------------------------------------------------------------------
// ConvexError shape check
// ---------------------------------------------------------------------------
//
// One spot-check that the validation errors are `ConvexError` (not plain
// `Error`), so the client toast path that reads `error.data` actually
// gets a user-safe message. Picking the description-length path because
// it's a self-contained validation that doesn't depend on plan/auth state.

test("validation errors are ConvexError with the message on .data", async () => {
  const { asUser } = await setup();
  await asUser
    .mutation(api.bundles.createBundle, {
      name: "x",
      description: "x".repeat(MAX_BUNDLE_DESCRIPTION_LENGTH + 1),
      skills: [],
      isPublic: true,
    })
    .then(
      () => {
        throw new Error("expected createBundle to reject");
      },
      (err: unknown) => {
        expect(err).toBeInstanceOf(ConvexError);
        expect(typeof (err as ConvexError<string>).data).toBe("string");
        expect((err as ConvexError<string>).data).toMatch(
          new RegExp(`Description must be ${MAX_BUNDLE_DESCRIPTION_LENGTH}`, "i"),
        );
      },
    );
});
