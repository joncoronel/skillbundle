/**
 * Coverage for `markBundleViewed`, the write half of bundle read state.
 *
 * This is the chosen alternative to email notification: rather than pushing
 * alerts, a bundle remembers when its owner last opened it and the dashboard
 * says "3 skills changed since your last visit". One optional timestamp, no
 * delivery, no unsubscribe, no alert fatigue to tune.
 *
 * The rule pinned here is ownership: only the OWNER can mark a bundle read.
 * Bundles are reachable signed-out and by link, so a stranger opening one must
 * not wipe the owner's unread state from across the internet.
 *
 * The BASELINE rule — that unread is measured from the later of `lastViewedAt`
 * and the skill's own `addedAt` — used to be pinned here too, against
 * `listUnreadCounts`. That query has been deleted (it was called by nothing but
 * these tests and defined "changed" differently from the surfaces users read),
 * and the rule is covered in tests/skill-versions-read.test.ts against
 * `listRecentChangesForUser`, which is where it is now actually implemented.
 */
import { test, expect, describe } from "vitest";
import { api } from "../convex/_generated/api";
import { makeTest } from "./_setup";

type TestHandle = ReturnType<typeof makeTest>;

const HOUR = 60 * 60 * 1000;

async function seedUser(t: TestHandle, externalId: string) {
  return await t.run(async (ctx) =>
    ctx.db.insert("users", {
      name: "Test User",
      email: `${externalId}@example.com`,
      externalId,
    }),
  );
}

async function seedSkill(t: TestHandle, skillId: string) {
  return await t.run(async (ctx) => {
    const skillDocId = await ctx.db.insert("skills", {
      source: "owner/repo",
      skillId,
      name: skillId,
      installs: 100,
      leaderboard: "alltime",
      lastSynced: Date.now(),
    });
    await ctx.db.insert("skillSummaries", {
      source: "owner/repo",
      skillId,
      name: skillId,
      installs: 100,
      skillDocId,
      isDelisted: false,
      lastSeenInApi: Date.now(),
    });
    return skillDocId;
  });
}

async function setup() {
  const t = makeTest();
  await seedUser(t, "user-1");
  for (const id of ["skill-a", "skill-b"]) await seedSkill(t, id);
  const asUser = t.withIdentity({ subject: "user-1" });

  const { bundleId } = await asUser.mutation(api.bundles.createBundle, {
    name: "Watchlist",
    skills: [
      { source: "owner/repo", skillId: "skill-a" },
      { source: "owner/repo", skillId: "skill-b" },
    ],
  });

  // createBundle stamps addedAt = now, and the baseline is the LATER of
  // lastViewedAt and addedAt — so a freshly created fixture can never have
  // unread skills no matter what timestamps a test sets afterwards. Backdate to
  // represent the normal case: a bundle that has existed for a while.
  await t.run(async (ctx) => {
    const bundle = await ctx.db.get(bundleId);
    await ctx.db.patch(bundleId, {
      skills: bundle!.skills.map((s) => ({ ...s, addedAt: Date.now() - 24 * HOUR })),
    });
  });

  return { t, asUser, bundleId };
}

// ---------------------------------------------------------------------------

describe("markBundleViewed", () => {
  test("stamps lastViewedAt for the owner", async () => {
    const { t, asUser, bundleId } = await setup();

    const before = Date.now();
    await asUser.mutation(api.bundles.markBundleViewed, { bundleId });

    const bundle = await t.run(async (ctx) => ctx.db.get(bundleId));
    expect(bundle!.lastViewedAt).toBeGreaterThanOrEqual(before);
  });

  test("is a silent no-op for a non-owner", async () => {
    const { t, bundleId } = await setup();
    await seedUser(t, "user-2");

    // Not a throw. The bundle page is reachable by share link, so a stranger
    // viewing it is an ordinary event, not an error worth surfacing.
    await expect(
      t
        .withIdentity({ subject: "user-2" })
        .mutation(api.bundles.markBundleViewed, { bundleId }),
    ).resolves.toBeNull();

    const bundle = await t.run(async (ctx) => ctx.db.get(bundleId));
    expect(bundle!.lastViewedAt).toBeUndefined();
  });

  test("is a silent no-op when signed out", async () => {
    const { t, bundleId } = await setup();

    await expect(
      t.mutation(api.bundles.markBundleViewed, { bundleId }),
    ).resolves.toBeNull();

    const bundle = await t.run(async (ctx) => ctx.db.get(bundleId));
    expect(bundle!.lastViewedAt).toBeUndefined();
  });
});
