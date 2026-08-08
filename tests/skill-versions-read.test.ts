/**
 * Coverage for the version-archive read API (convex/skillVersions.ts).
 *
 * Three behaviours here are judgement calls rather than mechanics, and those are
 * what these tests pin:
 *
 *   - **Audit regression is directional.** `pass → fail` deserves prominence;
 *     `fail → pass` is good news wearing the same shape. A boolean that fired on
 *     "different" instead of "worse" would put an alarm on every fix.
 *   - **A skill in two bundles reports once**, against whichever bundle has gone
 *     unread longest, so the feed reflects the worst case rather than an
 *     arbitrary one.
 *   - **The feed only shows what it can render.** A skill can be counted as
 *     unread (the mirrored timestamp moved) while having no archived version to
 *     diff — it changed before archiving existed. Count and feed are allowed to
 *     disagree, and the feed is the one that must stay honest.
 */
import { test, expect, describe } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { MASS_CHANGE_THRESHOLD } from "../convex/skillVersions";
import { makeTest } from "./_setup";

type TestHandle = ReturnType<typeof makeTest>;
/**
 * `withIdentity` returns a narrower handle than `makeTest` — it drops
 * `withIdentity` and `registerComponent` — so a helper taking an authenticated
 * caller must be typed against that, not against TestHandle.
 */
type IdentityHandle = ReturnType<TestHandle["withIdentity"]>;

const HOUR = 60 * 60 * 1000;
const SOURCE = "owner/repo";

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
      source: SOURCE,
      skillId,
      name: skillId,
      installs: 100,
      leaderboard: "alltime",
      lastSynced: Date.now(),
    });
    await ctx.db.insert("skillSummaries", {
      source: SOURCE,
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

async function addVersion(
  t: TestHandle,
  skillDocId: Id<"skills">,
  skillId: string,
  opts: {
    changedAt: number;
    raw?: string;
    syncHash?: string;
    frontmatterVersion?: string;
    descriptionChanged?: boolean;
    isBaseline?: boolean;
  },
) {
  return await t.run(async (ctx) => {
    const raw = opts.raw ?? `---\nname: ${skillId}\n---\nbody`;
    const rawStorageId = await ctx.storage.store(
      new Blob([raw], { type: "text/markdown" }),
    );
    return await ctx.db.insert("skillVersions", {
      skillDocId,
      source: SOURCE,
      skillId,
      changedAt: opts.changedAt,
      syncHash: opts.syncHash ?? `hash-${opts.changedAt}`,
      rawStorageId,
      rawBytes: raw.length,
      frontmatterVersion: opts.frontmatterVersion,
      descriptionChanged: opts.descriptionChanged ?? false,
      contentChanged: true,
      isBaseline: opts.isBaseline ?? false,
    });
  });
}

/** Mirror the timestamp the feed's cheap rejection reads. */
async function setContentUpdatedAt(t: TestHandle, skillId: string, at: number) {
  await t.run(async (ctx) => {
    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", SOURCE).eq("skillId", skillId),
      )
      .unique();
    await ctx.db.patch(summary!._id, { contentUpdatedAt: at });
  });
}

/** An audit row whose verdict moved at `changedAt`. */
async function addAudit(
  t: TestHandle,
  skillDocId: Id<"skills">,
  skillId: string,
  opts: {
    worstStatus: string;
    previousWorstStatus?: string;
    changedAt: number;
    riskLevel?: string;
  },
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("skillAudits", {
      skillDocId,
      source: SOURCE,
      skillId,
      audits: [],
      worstStatus: opts.worstStatus,
      worstRiskLevel: opts.riskLevel,
      previousWorstStatus: opts.previousWorstStatus,
      worstStatusChangedAt: opts.changedAt,
      fetchedAt: opts.changedAt,
    });
  });
}

// ---------------------------------------------------------------------------

describe("listForSkill", () => {
  test("returns versions newest first, with a fetchable content URL", async () => {
    const t = makeTest();
    const skillDocId = await seedSkill(t, "skill-a");
    const now = Date.now();
    await addVersion(t, skillDocId, "skill-a", {
      changedAt: now - 5 * HOUR,
      frontmatterVersion: "1.0.0",
      isBaseline: true,
    });
    await addVersion(t, skillDocId, "skill-a", {
      changedAt: now - 1 * HOUR,
      frontmatterVersion: "2.0.0",
    });

    const rows = await t.query(api.skillVersions.listForSkill, {
      source: SOURCE,
      skillId: "skill-a",
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].frontmatterVersion).toBe("2.0.0");
    expect(rows[1].isBaseline).toBe(true);
    // Content is never inlined — queries can't read storage bytes, and routing
    // 15 KB per version through a function would be the wrong shape anyway.
    expect(rows[0].contentUrl).toBeTruthy();
  });

  test("an unknown skill is empty, not an error", async () => {
    const t = makeTest();
    expect(
      await t.query(api.skillVersions.listForSkill, {
        source: SOURCE,
        skillId: "nope",
      }),
    ).toEqual([]);
  });

  test("a known skill with no recorded changes is empty", async () => {
    const t = makeTest();
    await seedSkill(t, "skill-a");

    // Expected for most of the catalog: archiving began Aug 2026, so a skill
    // that hasn't moved since has no rows. The UI must say "no changes recorded"
    // rather than implying none ever happened.
    expect(
      await t.query(api.skillVersions.listForSkill, {
        source: SOURCE,
        skillId: "skill-a",
      }),
    ).toEqual([]);
  });

  test("honours a limit", async () => {
    const t = makeTest();
    const skillDocId = await seedSkill(t, "skill-a");
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      await addVersion(t, skillDocId, "skill-a", { changedAt: now - i * HOUR });
    }

    const rows = await t.query(api.skillVersions.listForSkill, {
      source: SOURCE,
      skillId: "skill-a",
      limit: 2,
    });
    expect(rows).toHaveLength(2);
  });
});

describe("getVersions", () => {
  test("fetches an arbitrary pair for a cumulative diff", async () => {
    const t = makeTest();
    const skillDocId = await seedSkill(t, "skill-a");
    const now = Date.now();
    const ids: Id<"skillVersions">[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(
        await addVersion(t, skillDocId, "skill-a", {
          changedAt: now - (5 - i) * HOUR,
          raw: `version ${i}`,
        }),
      );
    }

    // v2 vs v5 — "everything that changed since I added this" — is the
    // comparison that justifies the feature, and it needs non-adjacent ids.
    const rows = await t.query(api.skillVersions.getVersions, {
      versionIds: [ids[1], ids[4]],
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.contentUrl)).toBe(true);
  });

  test("skips ids that no longer resolve", async () => {
    const t = makeTest();
    const skillDocId = await seedSkill(t, "skill-a");
    const id = await addVersion(t, skillDocId, "skill-a", {
      changedAt: Date.now(),
    });
    await t.run(async (ctx) => ctx.db.delete(id));

    expect(
      await t.query(api.skillVersions.getVersions, { versionIds: [id] }),
    ).toEqual([]);
  });
});

describe("getAuditChange", () => {
  async function seedAudit(
    t: TestHandle,
    skillDocId: Id<"skills">,
    worstStatus: string,
    previousWorstStatus?: string,
  ) {
    await t.run(async (ctx) =>
      ctx.db.insert("skillAudits", {
        skillDocId,
        source: SOURCE,
        skillId: "skill-a",
        audits: [],
        worstStatus,
        previousWorstStatus,
        worstStatusChangedAt: previousWorstStatus ? Date.now() : undefined,
        fetchedAt: Date.now(),
      }),
    );
  }

  test("flags a worsening verdict as a regression", async () => {
    const t = makeTest();
    const skillDocId = await seedSkill(t, "skill-a");
    await seedAudit(t, skillDocId, "fail", "pass");

    const row = await t.query(api.skillVersions.getAuditChange, {
      source: SOURCE,
      skillId: "skill-a",
    });
    expect(row!.regressed).toBe(true);
    expect(row!.previousWorstStatus).toBe("pass");
  });

  test("does not flag an improving verdict", async () => {
    const t = makeTest();
    const skillDocId = await seedSkill(t, "skill-a");
    await seedAudit(t, skillDocId, "pass", "fail");

    // A boolean keyed on "different" rather than "worse" would put a warning
    // banner on every skill that just got fixed.
    const row = await t.query(api.skillVersions.getAuditChange, {
      source: SOURCE,
      skillId: "skill-a",
    });
    expect(row!.regressed).toBe(false);
  });

  test("does not flag a first-ever verdict", async () => {
    const t = makeTest();
    const skillDocId = await seedSkill(t, "skill-a");
    await seedAudit(t, skillDocId, "fail");

    const row = await t.query(api.skillVersions.getAuditChange, {
      source: SOURCE,
      skillId: "skill-a",
    });
    expect(row!.regressed).toBe(false);
  });

  test("returns null when the skill has never been audited", async () => {
    const t = makeTest();
    await seedSkill(t, "skill-a");
    expect(
      await t.query(api.skillVersions.getAuditChange, {
        source: SOURCE,
        skillId: "skill-a",
      }),
    ).toBeNull();
  });
});

describe("listRecentChangesForUser", () => {
  async function setupFeed() {
    const t = makeTest();
    await seedUser(t, "user-1");
    const a = await seedSkill(t, "skill-a");
    const b = await seedSkill(t, "skill-b");
    const asUser = t.withIdentity({ subject: "user-1" });
    return { t, asUser, a, b };
  }

  async function makeBundle(
    t: TestHandle,
    asUser: IdentityHandle,
    name: string,
    skillIds: string[],
    patch: Record<string, unknown> = {},
  ) {
    const { bundleId } = await asUser.mutation(api.bundles.createBundle, {
      name,
      skills: skillIds.map((skillId) => ({ source: SOURCE, skillId })),
    });
    await t.run(async (ctx) => {
      const bundle = await ctx.db.get(bundleId);
      await ctx.db.patch(bundleId, {
        skills: bundle!.skills.map((s) => ({
          ...s,
          addedAt: Date.now() - 24 * HOUR,
        })),
        ...patch,
      });
    });
    return bundleId;
  }

  test("surfaces a skill that changed since the bundle was last opened", async () => {
    const { t, asUser, a } = await setupFeed();
    const now = Date.now();
    await makeBundle(t, asUser, "One", ["skill-a"], {
      lastViewedAt: now - 5 * HOUR,
    });
    await setContentUpdatedAt(t, "skill-a", now - 1 * HOUR);
    await addVersion(t, a, "skill-a", { changedAt: now - 1 * HOUR });

    const feed = await asUser.query(
      api.skillVersions.listRecentChangesForUser,
      {},
    );
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].skillId).toBe("skill-a");
    expect(feed.items[0].bundleName).toBe("One");
    expect(feed.items[0].kind).toBe("content");
    expect(feed.items[0].version).not.toBeNull();
    expect(feed.suppressed).toBe(false);
  });

  test("counts every watched skill, not just the changed ones", async () => {
    const { t, asUser, a } = await setupFeed();
    const now = Date.now();
    await makeBundle(t, asUser, "One", ["skill-a", "skill-b"], {
      lastViewedAt: now - 5 * HOUR,
    });
    await setContentUpdatedAt(t, "skill-a", now - 1 * HOUR);
    await addVersion(t, a, "skill-a", { changedAt: now - 1 * HOUR });

    const feed = await asUser.query(
      api.skillVersions.listRecentChangesForUser,
      {},
    );
    expect(feed.items).toHaveLength(1);
    // The all-clear readout leans on this to say "watching N skills"; it must
    // be the denominator, not the numerator.
    expect(feed.watchedSkillCount).toBe(2);
  });

  test("omits a skill whose change predates the last visit", async () => {
    const { t, asUser, a } = await setupFeed();
    const now = Date.now();
    await makeBundle(t, asUser, "One", ["skill-a"], {
      lastViewedAt: now - 1 * HOUR,
    });
    await setContentUpdatedAt(t, "skill-a", now - 5 * HOUR);
    await addVersion(t, a, "skill-a", { changedAt: now - 5 * HOUR });

    const feed = await asUser.query(
      api.skillVersions.listRecentChangesForUser,
      {},
    );
    expect(feed.items).toEqual([]);
  });

  test("reports a skill in two bundles once, against the longest-unread one", async () => {
    const { t, asUser, a } = await setupFeed();
    const now = Date.now();
    await makeBundle(t, asUser, "RecentlyOpened", ["skill-a"], {
      lastViewedAt: now - 2 * HOUR,
    });
    await makeBundle(t, asUser, "Neglected", ["skill-a"], {
      lastViewedAt: now - 20 * HOUR,
    });
    await setContentUpdatedAt(t, "skill-a", now - 1 * HOUR);
    await addVersion(t, a, "skill-a", { changedAt: now - 1 * HOUR });

    const feed = await asUser.query(
      api.skillVersions.listRecentChangesForUser,
      {},
    );
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].bundleName).toBe("Neglected");
  });

  test("omits an unread skill that has no archived version to show", async () => {
    const { t, asUser } = await setupFeed();
    const now = Date.now();
    await makeBundle(t, asUser, "One", ["skill-a"], {
      lastViewedAt: now - 5 * HOUR,
    });
    // Timestamp says it changed, but the change predates archiving so there is
    // nothing to render. The unread COUNT may include it; the feed must not
    // promise a diff it cannot produce.
    await setContentUpdatedAt(t, "skill-a", now - 1 * HOUR);

    const feed = await asUser.query(
      api.skillVersions.listRecentChangesForUser,
      {},
    );
    expect(feed.items).toEqual([]);
  });

  test("omits a skill whose only archived version is its baseline", async () => {
    const { t, asUser, a } = await setupFeed();
    const now = Date.now();
    await makeBundle(t, asUser, "One", ["skill-a"], {
      lastViewedAt: now - 5 * HOUR,
    });
    await setContentUpdatedAt(t, "skill-a", now - 1 * HOUR);
    // A baseline means "we started archiving this file", not "it changed". It
    // holds no previous content, so there is no diff to link to. The archive is
    // still backfilling, so this is the common case, not an edge one.
    await addVersion(t, a, "skill-a", {
      changedAt: now - 1 * HOUR,
      isBaseline: true,
    });

    const feed = await asUser.query(
      api.skillVersions.listRecentChangesForUser,
      {},
    );
    expect(feed.items).toEqual([]);
  });

  test("includes a skill once a real change lands on top of its baseline", async () => {
    const { t, asUser, a } = await setupFeed();
    const now = Date.now();
    await makeBundle(t, asUser, "One", ["skill-a"], {
      lastViewedAt: now - 10 * HOUR,
    });
    await setContentUpdatedAt(t, "skill-a", now - 1 * HOUR);
    await addVersion(t, a, "skill-a", {
      changedAt: now - 8 * HOUR,
      isBaseline: true,
    });
    await addVersion(t, a, "skill-a", { changedAt: now - 1 * HOUR });

    const feed = await asUser.query(
      api.skillVersions.listRecentChangesForUser,
      {},
    );
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].version?.isBaseline).toBe(false);
  });

  test("labels a description change so it can outrank a body edit", async () => {
    const { t, asUser, a } = await setupFeed();
    const now = Date.now();
    await makeBundle(t, asUser, "One", ["skill-a"], {
      lastViewedAt: now - 5 * HOUR,
    });
    await setContentUpdatedAt(t, "skill-a", now - 1 * HOUR);
    await addVersion(t, a, "skill-a", {
      changedAt: now - 1 * HOUR,
      descriptionChanged: true,
    });

    const feed = await asUser.query(
      api.skillVersions.listRecentChangesForUser,
      {},
    );
    expect(feed.items[0].kind).toBe("description");
  });

  test("surfaces a security regression even with no content change", async () => {
    const { t, asUser, a } = await setupFeed();
    const now = Date.now();
    await makeBundle(t, asUser, "One", ["skill-a"], {
      lastViewedAt: now - 5 * HOUR,
    });
    // No contentUpdatedAt bump at all: a re-audit of byte-identical content can
    // still flip the verdict, and that is the highest-severity event there is.
    await addAudit(t, a, "skill-a", {
      worstStatus: "fail",
      previousWorstStatus: "pass",
      changedAt: now - 1 * HOUR,
      riskLevel: "CRITICAL",
    });

    const feed = await asUser.query(
      api.skillVersions.listRecentChangesForUser,
      {},
    );
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].kind).toBe("audit");
    expect(feed.items[0].audit).toMatchObject({ from: "pass", to: "fail" });
    expect(feed.items[0].version).toBeNull();
  });

  test("ignores a verdict that improved", async () => {
    const { t, asUser, a } = await setupFeed();
    const now = Date.now();
    await makeBundle(t, asUser, "One", ["skill-a"], {
      lastViewedAt: now - 5 * HOUR,
    });
    await addAudit(t, a, "skill-a", {
      worstStatus: "pass",
      previousWorstStatus: "fail",
      changedAt: now - 1 * HOUR,
    });

    const feed = await asUser.query(
      api.skillVersions.listRecentChangesForUser,
      {},
    );
    expect(feed.items).toEqual([]);
  });

  test("ranks by consequence before recency", async () => {
    const { t, asUser, a, b } = await setupFeed();
    const now = Date.now();
    await makeBundle(t, asUser, "One", ["skill-a"], {
      lastViewedAt: now - 40 * HOUR,
    });
    await makeBundle(t, asUser, "Two", ["skill-b"], {
      lastViewedAt: now - 40 * HOUR,
    });
    // skill-b changed an hour ago; skill-a's verdict regressed nearly a day
    // ago. The older, worse event still leads. (Both sit inside the baseline,
    // which `makeBundle` puts at addedAt = now − 24h.)
    await setContentUpdatedAt(t, "skill-b", now - 1 * HOUR);
    await addVersion(t, b, "skill-b", { changedAt: now - 1 * HOUR });
    await addAudit(t, a, "skill-a", {
      worstStatus: "warn",
      previousWorstStatus: "pass",
      changedAt: now - 20 * HOUR,
    });

    const feed = await asUser.query(
      api.skillVersions.listRecentChangesForUser,
      {},
    );
    expect(feed.items.map((r) => r.skillId)).toEqual(["skill-a", "skill-b"]);
  });

  test("merges a regression and a content change into one row", async () => {
    const { t, asUser, a } = await setupFeed();
    const now = Date.now();
    await makeBundle(t, asUser, "One", ["skill-a"], {
      lastViewedAt: now - 5 * HOUR,
    });
    await setContentUpdatedAt(t, "skill-a", now - 2 * HOUR);
    await addVersion(t, a, "skill-a", { changedAt: now - 2 * HOUR });
    await addAudit(t, a, "skill-a", {
      worstStatus: "fail",
      previousWorstStatus: "warn",
      changedAt: now - 1 * HOUR,
    });

    const feed = await asUser.query(
      api.skillVersions.listRecentChangesForUser,
      {},
    );
    expect(feed.items).toHaveLength(1);
    // Headlined by the worse event, but the version rides along so the row can
    // still link to a diff.
    expect(feed.items[0].kind).toBe("audit");
    expect(feed.items[0].version).not.toBeNull();
  });

  test("orders newest first among events of equal consequence", async () => {
    const { t, asUser, a, b } = await setupFeed();
    const now = Date.now();
    await makeBundle(t, asUser, "One", ["skill-a"], { lastViewedAt: now - 20 * HOUR });
    await makeBundle(t, asUser, "Two", ["skill-b"], { lastViewedAt: now - 20 * HOUR });
    await setContentUpdatedAt(t, "skill-a", now - 6 * HOUR);
    await setContentUpdatedAt(t, "skill-b", now - 2 * HOUR);
    await addVersion(t, a, "skill-a", { changedAt: now - 6 * HOUR });
    await addVersion(t, b, "skill-b", { changedAt: now - 2 * HOUR });

    const feed = await asUser.query(
      api.skillVersions.listRecentChangesForUser,
      {},
    );
    expect(feed.items.map((r) => r.skillId)).toEqual(["skill-b", "skill-a"]);
  });

  test("returns nothing when signed out", async () => {
    const { t } = await setupFeed();
    const feed = await t.query(api.skillVersions.listRecentChangesForUser, {});
    expect(feed.items).toEqual([]);
    expect(feed.watchedSkillCount).toBe(0);
  });
});

describe("listRecentChangesForUser — mass-change suppression", () => {
  /**
   * The breaker guards against OUR pipeline rewriting hashes catalog-wide, so
   * the fixture is a catalog-wide event: many skills, all moving at once. The
   * user only watches a handful of them.
   */
  async function setupMass(t: TestHandle, catalogChanges: number) {
    const now = Date.now();
    await seedUser(t, "user-1");
    const asUser = t.withIdentity({ subject: "user-1" });
    const watched: string[] = [];

    for (let i = 0; i < 10; i++) {
      const id = `watched-${i}`;
      const docId = await seedSkill(t, id);
      await setContentUpdatedAt(t, id, now - 1 * HOUR);
      await addVersion(t, docId, id, { changedAt: now - 1 * HOUR });
      watched.push(id);
    }

    // The rest of the catalog moving in the same window is what trips it.
    for (let i = 0; i < catalogChanges; i++) {
      const id = `other-${i}`;
      const docId = await seedSkill(t, id);
      await addVersion(t, docId, id, { changedAt: now - 1 * HOUR });
    }

    const { bundleId } = await asUser.mutation(api.bundles.createBundle, {
      name: "One",
      skills: watched.map((skillId) => ({ source: SOURCE, skillId })),
    });
    await t.run(async (ctx) => {
      const bundle = await ctx.db.get(bundleId);
      await ctx.db.patch(bundleId, {
        lastViewedAt: now - 5 * HOUR,
        skills: bundle!.skills.map((s) => ({
          ...s,
          addedAt: now - 24 * HOUR,
        })),
      });
    });
    return asUser;
  }

  test("trips when the whole catalog moves at once", async () => {
    const t = makeTest();
    // Seeded off the live threshold, not a literal. The constant is expected to
    // move again once the archive has enough history to measure a real daily
    // rate, and a hardcoded count would fail as a false alarm when it does.
    const asUser = await setupMass(t, MASS_CHANGE_THRESHOLD + 20);

    const feed = await asUser.query(
      api.skillVersions.listRecentChangesForUser,
      {},
    );
    expect(feed.suppressed).toBe(true);
    // Items still come back — the reads are already paid for, and the UI puts
    // them behind a disclosure rather than a second round trip.
    expect(feed.items).toHaveLength(10);
  });

  test("stays clear on an ordinary day", async () => {
    const t = makeTest();
    const asUser = await setupMass(t, 20);

    const feed = await asUser.query(
      api.skillVersions.listRecentChangesForUser,
      {},
    );
    expect(feed.suppressed).toBe(false);
  });

  test("ignores a burst of baselines", async () => {
    const t = makeTest();
    const now = Date.now();
    const asUser = await setupMass(t, 0);
    // The archive backfills hundreds of baselines a day by design. A breaker
    // that fires on those would be permanently tripped during normal operation.
    await Promise.all(
      Array.from({ length: 400 }, async (_, i) => {
        const id = `baseline-${i}`;
        const docId = await seedSkill(t, id);
        await addVersion(t, docId, id, {
          changedAt: now - 1 * HOUR,
          isBaseline: true,
        });
      }),
    );

    const feed = await asUser.query(
      api.skillVersions.listRecentChangesForUser,
      {},
    );
    expect(feed.suppressed).toBe(false);
  });

  test("a baseline burst cannot blind the count", async () => {
    const t = makeTest();
    const now = Date.now();
    const asUser = await setupMass(t, MASS_CHANGE_THRESHOLD + 20);

    // Baselines dated EARLIER than the real changes, which is the ordering that
    // used to break this: the old implementation read a capped page of the
    // window oldest-first and only then discarded baselines, so a backfill at
    // the head of the day ate the budget and the real changes behind it were
    // never counted. A breaker that fails silent is worse than none, so this
    // pins the fix — baselines are now excluded by the index, not after the read.
    await Promise.all(
      Array.from({ length: 400 }, async (_, i) => {
        const id = `earlier-baseline-${i}`;
        const docId = await seedSkill(t, id);
        await addVersion(t, docId, id, {
          changedAt: now - 20 * HOUR,
          isBaseline: true,
        });
      }),
    );

    const feed = await asUser.query(
      api.skillVersions.listRecentChangesForUser,
      {},
    );
    expect(feed.suppressed).toBe(true);
  });
});
