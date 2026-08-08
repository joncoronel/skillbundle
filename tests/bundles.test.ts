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
import { api, internal } from "../convex/_generated/api";
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
    });
    const after = Date.now();

    const bundle = await t.run(async (ctx) => ctx.db.get(bundleId));
    expect(bundle).not.toBeNull();
    expect(bundle!.name).toBe("My Bundle");
    expect(bundle!.description).toBe("A short description");
    expect(bundle!.userId).toBe(userId);
    // Closed on creation — see the "createBundle visibility" block below.
    expect(bundle!.isPublic).toBe(false);
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
    });

    const bundle = await t.run(async (ctx) => ctx.db.get(bundleId));
    expect(bundle!.description).toBeUndefined();
  });

  test("omitting description leaves it undefined", async () => {
    const { t, asUser } = await setup();
    const { bundleId } = await asUser.mutation(api.bundles.createBundle, {
      name: "No description",
      skills: [{ source: "owner/repo", skillId: "skill-a" }],
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
          isPublic: false,
          name: `Existing ${i}`,
          urlId: `existing-${i}`,
          skills: [],
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    await expect(
      asUser.mutation(api.bundles.createBundle, {
        name: "One too many",
        skills: [{ source: "owner/repo", skillId: "skill-a" }],
      }),
    ).rejects.toThrow(/Bundle limit reached/i);
  });

  test("rejects when unauthenticated", async () => {
    const t = makeTest();
    await expect(
      t.mutation(api.bundles.createBundle, {
        name: "Anon",
        skills: [],
      }),
    ).rejects.toThrow(/get current user/i);
  });

  // REMOVED: "rejects private bundle on free plan". Private is the default now,
  // so there is no gate to test — see "createBundle visibility" below.
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
          isPublic: false,
        name: "Existing",
        urlId: `seed-${Math.random().toString(36).slice(2, 8)}`,
        skills,
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
          isPublic: false,
        name: "Existing",
        urlId: `desc-${Math.random().toString(36).slice(2, 8)}`,
        description,
        skills: [],
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
          isPublic: false,
        name: "Old",
        urlId: "old-stamp",
        skills: [],
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
// getByUrlId access gate (one-link model)
// ---------------------------------------------------------------------------

describe("getByUrlId access", () => {
  async function seedBundle(
    t: TestHandle,
    userId: Id<"users">,
    isPublic: boolean,
  ) {
    return await t.run(async (ctx) => {
      const now = Date.now();
      const id = await ctx.db.insert("bundles", {
        userId,
        isPublic,
        name: isPublic ? "Shared bundle" : "Closed bundle",
        urlId: `gate-${Math.random().toString(36).slice(2, 8)}`,
        skills: [],
        createdAt: now,
        updatedAt: now,
      });
      return (await ctx.db.get(id))!.urlId;
    });
  }

  test("a closed bundle answers only to its owner", async () => {
    const { t, asUser, userId } = await setup();
    const urlId = await seedBundle(t, userId, false);

    // There is no second token-bearing URL to try any more: the bundle's own
    // link is the only address, and for a closed bundle it resolves for the
    // owner and nobody else.
    expect(await t.query(api.bundles.getByUrlId, { urlId })).toBeNull();

    const asOwner = await asUser.query(api.bundles.getByUrlId, { urlId });
    expect(asOwner).not.toBeNull();
    expect(asOwner!.urlId).toBe(urlId);
  });

  test("an open bundle answers to anyone with the link", async () => {
    const { t, userId } = await setup();
    const urlId = await seedBundle(t, userId, true);

    const anonymous = await t.query(api.bundles.getByUrlId, { urlId });
    expect(anonymous).not.toBeNull();
    expect(anonymous!.isOwner).toBe(false);
  });

  test("a stranger cannot see the owner's read state", async () => {
    const { t, userId } = await setup();
    const urlId = await seedBundle(t, userId, true);
    await t.run(async (ctx) => {
      const b = await ctx.db
        .query("bundles")
        .withIndex("by_urlId", (q) => q.eq("urlId", urlId))
        .unique();
      await ctx.db.patch(b!._id, { lastViewedAt: Date.now() });
    });

    const anonymous = await t.query(api.bundles.getByUrlId, { urlId });
    expect(anonymous!.lastViewedAt).toBeUndefined();
  });
});

describe("createBundle visibility", () => {
  test("creates closed, regardless of plan", async () => {
    const { t, asUser } = await setup();
    const { bundleId } = await asUser.mutation(api.bundles.createBundle, {
      name: "Fresh",
      skills: [],
    });
    const bundle = await t.run(async (ctx) => ctx.db.get(bundleId));
    // The set of skills you depend on is private until you decide otherwise;
    // creation is not the moment to ask.
    expect(bundle!.isPublic).toBe(false);
  });

  test("the owner can open and close it with no plan gate", async () => {
    const { t, asUser } = await setup();
    const { bundleId } = await asUser.mutation(api.bundles.createBundle, {
      name: "Toggle",
      skills: [],
    });

    await asUser.mutation(api.bundles.updateBundleVisibility, {
      bundleId,
      isPublic: true,
    });
    expect((await t.run(async (ctx) => ctx.db.get(bundleId)))!.isPublic).toBe(
      true,
    );

    // Closing used to be Pro-gated, back when open was the default. Closed is
    // the default now, so charging for it would be charging for the default.
    await asUser.mutation(api.bundles.updateBundleVisibility, {
      bundleId,
      isPublic: false,
    });
    expect((await t.run(async (ctx) => ctx.db.get(bundleId)))!.isPublic).toBe(
      false,
    );
  });
});

describe("migrateOneLinkModel", () => {
  test("closes old public bundles and strips the dead fields, idempotently", async () => {
    const { t, userId } = await setup();
    await t.run(async (ctx) => {
      const now = Date.now();
      const rows: Array<[boolean, string | undefined]> = [
        [true, "old-share-token"],
        [true, undefined],
        [false, undefined],
      ];
      for (const [isPublic, shareToken] of rows) {
        await ctx.db.insert("bundles", {
          userId,
          isPublic,
          shareToken,
          featuredAt: shareToken ? now : undefined,
          name: "Legacy",
          urlId: `legacy-${Math.random().toString(36).slice(2, 8)}`,
          skills: [],
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    const first = await t.mutation(internal.bundles.migrateOneLinkModel, {});
    expect(first).toEqual({ scanned: 3, closed: 2, fieldsStripped: 1 });

    // Idempotent: the second run must find nothing left to do, because the
    // schema field removal that follows it is a one-way door.
    const second = await t.mutation(internal.bundles.migrateOneLinkModel, {});
    expect(second).toEqual({ scanned: 3, closed: 0, fieldsStripped: 0 });

    const remaining = await t.run(async (ctx) =>
      ctx.db.query("bundles").collect(),
    );
    expect(remaining.every((b) => !b.isPublic)).toBe(true);
    expect(remaining.every((b) => b.shareToken === undefined)).toBe(true);
    expect(remaining.every((b) => b.featuredAt === undefined)).toBe(true);
  });
});

describe("createBundle urlId", () => {
  test("produces a 10-char base62 urlId", async () => {
    const { t, asUser } = await setup();
    const { bundleId } = await asUser.mutation(api.bundles.createBundle, {
      name: "UrlId check",
      skills: [{ source: "owner/repo", skillId: "skill-a" }],
    });
    const bundle = await t.run(async (ctx) => ctx.db.get(bundleId));
    expect(bundle!.urlId).toMatch(/^[A-Za-z0-9]{10}$/);
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
