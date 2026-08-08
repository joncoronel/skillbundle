/**
 * Coverage for the "since you last looked" read state on bundles.
 *
 * This is the chosen alternative to email notification: rather than pushing
 * alerts, a bundle remembers when its owner last opened it and can say "3 skills
 * changed since your last visit". One optional timestamp, no delivery, no
 * unsubscribe, no alert fatigue to tune.
 *
 * Two rules carry the whole feature, and both are easy to get subtly wrong:
 *
 *   1. The unread baseline is the LATER of `lastViewedAt` and the skill's own
 *      `addedAt`. Using the visit alone would greet a skill added five minutes
 *      ago with months of unread back catalogue; using addedAt alone would never
 *      clear once it went unread.
 *   2. Only the OWNER can mark a bundle read. Bundles are reachable signed-out
 *      and by share link, so a stranger opening one must not wipe the owner's
 *      unread state from across the internet.
 *
 * The counting query reads `skillSummaries` rather than `skills` deliberately —
 * see listUnreadCounts — so these tests seed both and set `contentUpdatedAt` on
 * the summary, which is where the query actually looks.
 */
import { test, expect, describe } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
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

/** Set when a skill last actually changed, on the row the query reads. */
async function setContentUpdatedAt(
  t: TestHandle,
  skillId: string,
  at: number,
) {
  await t.run(async (ctx) => {
    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", "owner/repo").eq("skillId", skillId),
      )
      .unique();
    await ctx.db.patch(summary!._id, { contentUpdatedAt: at });
  });
}

async function setBundle(
  t: TestHandle,
  bundleId: Id<"bundles">,
  patch: Record<string, unknown>,
) {
  await t.run(async (ctx) => ctx.db.patch(bundleId, patch));
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

async function unreadFor(t: TestHandle, identity: string) {
  const rows = await t
    .withIdentity({ subject: identity })
    .query(api.bundles.listUnreadCounts, {});
  return rows[0];
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

describe("listUnreadCounts", () => {
  test("counts a skill that changed after the last visit", async () => {
    const { t, bundleId } = await setup();
    const now = Date.now();

    await setBundle(t, bundleId, { lastViewedAt: now - 5 * HOUR });
    await setContentUpdatedAt(t, "skill-a", now - 1 * HOUR);

    const row = await unreadFor(t, "user-1");
    expect(row.unreadCount).toBe(1);
    expect(row.skillCount).toBe(2);
  });

  test("ignores a change that predates the last visit", async () => {
    const { t, bundleId } = await setup();
    const now = Date.now();

    await setBundle(t, bundleId, { lastViewedAt: now - 1 * HOUR });
    await setContentUpdatedAt(t, "skill-a", now - 5 * HOUR);

    expect((await unreadFor(t, "user-1")).unreadCount).toBe(0);
  });

  test("viewing the bundle clears the count", async () => {
    const { t, asUser, bundleId } = await setup();
    const now = Date.now();

    await setBundle(t, bundleId, { lastViewedAt: now - 5 * HOUR });
    await setContentUpdatedAt(t, "skill-a", now - 1 * HOUR);
    expect((await unreadFor(t, "user-1")).unreadCount).toBe(1);

    await asUser.mutation(api.bundles.markBundleViewed, { bundleId });

    expect((await unreadFor(t, "user-1")).unreadCount).toBe(0);
  });

  test("a skill added after a change does not arrive pre-marked unread", async () => {
    const { t, bundleId } = await setup();
    const now = Date.now();

    // The skill changed a week ago; the user added it an hour ago and has never
    // opened the bundle. Keying off lastViewedAt alone (0 here) would count that
    // week-old edit as news, which is the single most confusing thing this
    // feature could do on someone's first visit.
    await setContentUpdatedAt(t, "skill-a", now - 7 * 24 * HOUR);
    await setBundle(t, bundleId, {
      lastViewedAt: undefined,
      skills: [
        { source: "owner/repo", skillId: "skill-a", addedAt: now - 1 * HOUR },
        { source: "owner/repo", skillId: "skill-b", addedAt: now - 1 * HOUR },
      ],
    });

    expect((await unreadFor(t, "user-1")).unreadCount).toBe(0);
  });

  test("addedAt wins over an older visit as the baseline", async () => {
    const { t, bundleId } = await setup();
    const now = Date.now();

    // Visited long ago, skill added recently, change between the two. The
    // baseline must be the later of the pair (addedAt), not the visit.
    await setBundle(t, bundleId, {
      lastViewedAt: now - 10 * HOUR,
      skills: [
        { source: "owner/repo", skillId: "skill-a", addedAt: now - 2 * HOUR },
        { source: "owner/repo", skillId: "skill-b", addedAt: now - 10 * HOUR },
      ],
    });
    await setContentUpdatedAt(t, "skill-a", now - 6 * HOUR);

    expect((await unreadFor(t, "user-1")).unreadCount).toBe(0);
  });

  test("counts skills, not changes", async () => {
    const { t, bundleId } = await setup();
    const now = Date.now();

    await setBundle(t, bundleId, { lastViewedAt: now - 10 * HOUR });
    await setContentUpdatedAt(t, "skill-a", now - 1 * HOUR);
    await setContentUpdatedAt(t, "skill-b", now - 2 * HOUR);

    // "2 skills changed" is actionable; a change tally would not be.
    expect((await unreadFor(t, "user-1")).unreadCount).toBe(2);
  });

  test("returns nothing when signed out", async () => {
    const { t } = await setup();
    expect(await t.query(api.bundles.listUnreadCounts, {})).toEqual([]);
  });
});
