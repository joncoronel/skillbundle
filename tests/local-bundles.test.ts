/**
 * Coverage for bundles saved in the browser while signed out: the pure rules
 * in lib/local-bundles-core.ts, and the Convex surface they lean on.
 *
 * What is pinned, and why each matters:
 *
 *   - **The browser gets the free plan's limits.** Signing in moves these
 *     bundles into an account, so a browser allowed more than a free account
 *     would have them refused on the way in.
 *   - **`importLocalBundles` moves what fits and reports the rest.** Throwing
 *     on the first bundle over the limit would roll back the ones that fit and
 *     leave the user with nothing moved.
 *   - **The first write can precede the Clerk webhook.** The import is a new
 *     account's first action, so it must not need the users row to exist.
 *   - **The read queries answer like the account ones.** A skill that changed
 *     after it was added shows up the same way whichever dashboard asks.
 */
import { test, expect, describe } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { makeTest } from "./_setup";
import { FREE_WATCHED_SKILLS } from "../lib/bundle-limits";
import {
  localFeedTargets,
  localSaveRefusal,
  mergeSkills,
  type LocalBundle,
} from "../lib/local-bundles-core";

type TestHandle = ReturnType<typeof makeTest>;

const HOUR = 60 * 60 * 1000;
const SOURCE = "owner/repo";

const skill = (skillId: string) => ({ source: SOURCE, skillId, name: skillId });

function localBundle(
  id: string,
  skillIds: string[],
  extra: Partial<LocalBundle> = {},
): LocalBundle {
  return {
    id,
    name: id,
    skills: skillIds.map((s) => ({ ...skill(s), addedAt: 1000 })),
    createdAt: 1000,
    updatedAt: 1000,
    ...extra,
  };
}

describe("local-bundles-core", () => {
  test("refuses a save past the free plan's distinct skills", () => {
    const ids = Array.from({ length: FREE_WATCHED_SKILLS }, (_, i) => `s${i}`);
    const bundles = [localBundle("a", ids)];
    expect(localSaveRefusal(bundles, [skill("extra")])).toMatch(
      /free plan covers/,
    );
  });

  test("re-filing a skill already watched in another bundle is free", () => {
    const ids = Array.from({ length: FREE_WATCHED_SKILLS }, (_, i) => `s${i}`);
    const bundles = [localBundle("a", ids)];
    expect(localSaveRefusal(bundles, [skill("s0"), skill("s1")])).toBeNull();
  });

  test("editing a bundle doesn't count its own skills twice", () => {
    const ids = Array.from({ length: FREE_WATCHED_SKILLS }, (_, i) => `s${i}`);
    const bundles = [localBundle("a", ids)];
    expect(localSaveRefusal(bundles, ids.map(skill), "a")).toBeNull();
  });

  test("mergeSkills keeps addedAt for kept skills and dedupes", () => {
    const prior = [{ ...skill("a"), addedAt: 5 }];
    const merged = mergeSkills(prior, [skill("a"), skill("b"), skill("a")], 99);
    expect(merged).toEqual([
      { ...skill("a"), addedAt: 5 },
      { ...skill("b"), addedAt: 99 },
    ]);
  });

  test("feed targets report a shared skill against its oldest baseline", () => {
    const targets = localFeedTargets([
      localBundle("new", ["a"], { lastViewedAt: 5000 }),
      localBundle("old", ["a"], { lastViewedAt: 2000 }),
    ]);
    expect(targets).toEqual([
      { source: SOURCE, skillId: "a", baseline: 2000, bundleName: "old" },
    ]);
  });
});

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

async function recordChange(
  t: TestHandle,
  skillDocId: Id<"skills">,
  skillId: string,
  at: number,
) {
  await t.run(async (ctx) => {
    const rawStorageId = await ctx.storage.store(
      new Blob(["---\nname: x\n---\nbody"], { type: "text/markdown" }),
    );
    await ctx.db.insert("skillVersions", {
      skillDocId,
      source: SOURCE,
      skillId,
      changedAt: at,
      syncHash: `hash-${at}`,
      rawStorageId,
      rawBytes: 20,
      descriptionChanged: false,
      contentChanged: true,
      isBaseline: false,
    });
    const summary = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId", (q) =>
        q.eq("source", SOURCE).eq("skillId", skillId),
      )
      .unique();
    await ctx.db.patch(summary!._id, { contentUpdatedAt: at });
  });
}

const importArgs = (
  bundles: { name: string; skillIds: string[]; addedAt?: number }[],
) => ({
  bundles: bundles.map((b) => ({
    localId: b.name,
    name: b.name,
    skills: b.skillIds.map((skillId) => ({
      source: SOURCE,
      skillId,
      addedAt: b.addedAt ?? Date.now() - HOUR,
    })),
    createdAt: Date.now() - HOUR,
  })),
});

describe("importLocalBundles", () => {
  test("creates the user row when the Clerk webhook hasn't arrived", async () => {
    const t = makeTest();
    await seedSkill(t, "skill-a");
    const asNewUser = t.withIdentity({ subject: "new-user", name: "Ada" });

    const result = await asNewUser.mutation(
      api.bundles.importLocalBundles,
      importArgs([{ name: "Mine", skillIds: ["skill-a"] }]),
    );

    expect(result.imported).toHaveLength(1);
    expect(result.skipped).toEqual([]);
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ externalId: "new-user", name: "Ada" });
    const bundles = await t.run((ctx) => ctx.db.query("bundles").collect());
    expect(bundles[0]).toMatchObject({ name: "Mine", isPublic: false });
  });

  test("keeps the browser's addedAt so change tracking carries over", async () => {
    const t = makeTest();
    await seedSkill(t, "skill-a");
    const asUser = t.withIdentity({ subject: "user-1" });
    const addedAt = Date.now() - 10 * HOUR;

    await asUser.mutation(
      api.bundles.importLocalBundles,
      importArgs([{ name: "Mine", skillIds: ["skill-a"], addedAt }]),
    );

    const bundle = await t.run((ctx) => ctx.db.query("bundles").first());
    expect(bundle!.skills[0].addedAt).toBe(addedAt);
  });

  test("a repeated import returns the bundles it already moved", async () => {
    const t = makeTest();
    await seedSkill(t, "skill-a");
    const asUser = t.withIdentity({ subject: "user-1" });
    const args = importArgs([{ name: "Mine", skillIds: ["skill-a"] }]);

    // The tab closed before the browser could clear the bundle, so the next
    // load sends it again.
    const first = await asUser.mutation(api.bundles.importLocalBundles, args);
    const second = await asUser.mutation(api.bundles.importLocalBundles, args);

    expect(second.imported).toEqual(first.imported);
    const bundles = await t.run((ctx) => ctx.db.query("bundles").collect());
    expect(bundles).toHaveLength(1);
  });

  test("drops skills that left the catalog instead of failing", async () => {
    const t = makeTest();
    await seedSkill(t, "skill-a");
    const asUser = t.withIdentity({ subject: "user-1" });

    const result = await asUser.mutation(
      api.bundles.importLocalBundles,
      importArgs([{ name: "Mine", skillIds: ["skill-a", "gone"] }]),
    );

    expect(result.imported).toHaveLength(1);
    const bundle = await t.run((ctx) => ctx.db.query("bundles").first());
    expect(bundle!.skills.map((s) => s.skillId)).toEqual(["skill-a"]);
  });

  test("moves what fits under the watch limit and reports the rest", async () => {
    const t = makeTest();
    const ids = Array.from(
      { length: FREE_WATCHED_SKILLS + 1 },
      (_, i) => `skill-${i}`,
    );
    for (const id of ids) await seedSkill(t, id);
    const asUser = t.withIdentity({ subject: "user-1" });

    // The account already watches 25; a browser bundle with a 26th doesn't
    // fit, but one re-filing skills it already watches does.
    await asUser.mutation(
      api.bundles.importLocalBundles,
      importArgs([{ name: "Existing", skillIds: ids.slice(0, -1) }]),
    );
    const result = await asUser.mutation(
      api.bundles.importLocalBundles,
      importArgs([
        { name: "Too many", skillIds: [ids[ids.length - 1]] },
        { name: "Refiled", skillIds: [ids[0], ids[1]] },
      ]),
    );

    expect(result.skipped).toEqual([{ index: 0, reason: "watch_limit" }]);
    expect(result.imported.map((i) => i.index)).toEqual([1]);
  });
});

describe("browser-bundle read queries", () => {
  test("listChangesForSkills reports a change made after addedAt", async () => {
    const t = makeTest();
    const a = await seedSkill(t, "skill-a");
    await seedSkill(t, "skill-b");
    const now = Date.now();
    await recordChange(t, a, "skill-a", now - HOUR);

    const result = await t.query(api.skillVersions.listChangesForSkills, {
      skills: [
        { source: SOURCE, skillId: "skill-a", addedAt: now - 5 * HOUR },
        { source: SOURCE, skillId: "skill-b", addedAt: now - 5 * HOUR },
      ],
    });

    expect(result.items.map((i) => i.key)).toEqual([`${SOURCE}::skill-a`]);
  });

  test("listRecentChangesForSkills echoes the bundle name", async () => {
    const t = makeTest();
    const a = await seedSkill(t, "skill-a");
    const now = Date.now();
    await recordChange(t, a, "skill-a", now - HOUR);

    const feed = await t.query(api.skillVersions.listRecentChangesForSkills, {
      skills: [
        {
          source: SOURCE,
          skillId: "skill-a",
          baseline: now - 5 * HOUR,
          bundleName: "Mine",
        },
      ],
    });

    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]).toMatchObject({
      skillId: "skill-a",
      bundleName: "Mine",
      kind: "content",
    });
    expect(feed.watchedSkillCount).toBe(1);
  });

  test("resolveSkills returns catalog rows in the order sent", async () => {
    const t = makeTest();
    await seedSkill(t, "skill-a");

    const rows = await t.query(api.bundles.resolveSkills, {
      skills: [
        { source: SOURCE, skillId: "skill-a", addedAt: 5 },
        { source: SOURCE, skillId: "gone" },
      ],
    });

    expect(rows.map((r) => [r.skillId, r.name, r.addedAt])).toEqual([
      ["skill-a", "skill-a", 5],
      ["gone", "gone", undefined],
    ]);
  });
});
