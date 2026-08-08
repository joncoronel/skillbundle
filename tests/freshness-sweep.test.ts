/**
 * Coverage for the per-repo freshness sweep (convex/freshness.ts).
 *
 * The sweep's job is to flag FEWER skills than the 7-day timer would, by asking
 * GitHub which blob SHAs actually moved. Every bug in it is therefore one of two
 * shapes:
 *
 *   - **Over-flagging** costs money and defeats the point. Flagging a skill
 *     whose SHA is unchanged, or every skill on the very first sweep because
 *     none of them have a stored SHA yet, would queue a full-catalog re-fetch
 *     and make this more expensive than the timer it was built to undercut.
 *   - **Under-flagging** is safe here but only because `markStaleContent` still
 *     runs on its 7-day cadence behind this. The skip paths below are all
 *     deliberate, and each one is a case the timer is expected to cover.
 *
 * The tests split accordingly: the pure URL→path parser, the row filter that
 * decides what is even eligible, and the write that applies a result.
 */
import { test, expect, describe } from "vitest";
import { internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { makeTest } from "./_setup";
import { pathFromRawUrl } from "../convex/freshness";

type TestHandle = ReturnType<typeof makeTest>;

const raw = (path: string) =>
  `https://raw.githubusercontent.com/owner/repo/main/${path}`;

async function seedSkill(
  t: TestHandle,
  opts: {
    source: string;
    skillId: string;
    skillMdUrl?: string;
    githubBlobSha?: string;
    isDelisted?: boolean;
  },
) {
  return await t.run(async (ctx) => {
    const skillDocId = await ctx.db.insert("skills", {
      source: opts.source,
      skillId: opts.skillId,
      name: opts.skillId,
      installs: 100,
      leaderboard: "alltime",
      lastSynced: Date.now(),
      skillMdUrl: opts.skillMdUrl,
      githubBlobSha: opts.githubBlobSha,
    });
    await ctx.db.insert("skillSummaries", {
      source: opts.source,
      skillId: opts.skillId,
      name: opts.skillId,
      installs: 100,
      skillDocId,
      isDelisted: opts.isDelisted ?? false,
      lastSeenInApi: Date.now(),
      skillMdUrl: opts.skillMdUrl,
      githubBlobSha: opts.githubBlobSha,
    });
    return skillDocId;
  });
}

async function sweepRows(t: TestHandle) {
  return await t.run(async (ctx) =>
    ctx.runQuery(internal.freshness.listSummariesForSweep, {}),
  );
}

// ---------------------------------------------------------------------------

describe("pathFromRawUrl", () => {
  test("recovers the tree path from a stored raw URL", () => {
    expect(pathFromRawUrl(raw("skills/alpha/SKILL.md"))).toBe(
      "skills/alpha/SKILL.md",
    );
    expect(pathFromRawUrl(raw("SKILL.md"))).toBe("SKILL.md");
  });

  test("returns null for anything that is not a raw.githubusercontent URL", () => {
    // A non-match must not become a bogus path: it would miss in shaByPath and
    // be silently treated as a deleted file forever.
    expect(pathFromRawUrl("https://example.com/a/b/c/SKILL.md")).toBeNull();
    expect(pathFromRawUrl("https://github.com/owner/repo/blob/main/SKILL.md"))
      .toBeNull();
    expect(pathFromRawUrl("")).toBeNull();
  });

  test("returns null when there is no path after the branch", () => {
    expect(pathFromRawUrl("https://raw.githubusercontent.com/o/r/main/"))
      .toBeNull();
  });
});

describe("listSummariesForSweep", () => {
  test("groups eligible skills by repo", async () => {
    const t = makeTest();
    await seedSkill(t, {
      source: "owner/repo",
      skillId: "a",
      skillMdUrl: raw("skills/a/SKILL.md"),
      githubBlobSha: "sha-a",
    });
    await seedSkill(t, {
      source: "owner/repo",
      skillId: "b",
      skillMdUrl: raw("skills/b/SKILL.md"),
      githubBlobSha: "sha-b",
    });
    await seedSkill(t, {
      source: "other/repo",
      skillId: "c",
      skillMdUrl: raw("SKILL.md"),
    });

    const { repos } = await sweepRows(t);
    const byName = Object.fromEntries(repos.map((r) => [r.source, r.skills]));
    expect(Object.keys(byName).sort()).toEqual(["other/repo", "owner/repo"]);
    // Grouping is what makes this per-repo rather than per-skill; two skills in
    // one repo must cost one tree call, not two.
    expect(byName["owner/repo"]).toHaveLength(2);
    expect(byName["owner/repo"][0].path).toBe("skills/a/SKILL.md");
  });

  test("skips well-known sources, which have no tree to walk", async () => {
    const t = makeTest();
    await seedSkill(t, {
      source: "mintlify.com",
      skillId: "mintlify",
      skillMdUrl: raw("SKILL.md"),
      githubBlobSha: "sha",
    });

    expect((await sweepRows(t)).repos).toEqual([]);
  });

  test("skips delisted skills", async () => {
    const t = makeTest();
    await seedSkill(t, {
      source: "owner/repo",
      skillId: "gone",
      skillMdUrl: raw("SKILL.md"),
      githubBlobSha: "sha",
      isDelisted: true,
    });

    expect((await sweepRows(t)).repos).toEqual([]);
  });

  test("skips skills with no resolved SKILL.md URL", async () => {
    const t = makeTest();
    await seedSkill(t, { source: "owner/repo", skillId: "undiscovered" });

    // Still waiting on discovery — there is no path to compare against.
    expect((await sweepRows(t)).repos).toEqual([]);
  });

  test("skips a URL whose path cannot be parsed", async () => {
    const t = makeTest();
    await seedSkill(t, {
      source: "owner/repo",
      skillId: "odd",
      skillMdUrl: "https://example.com/somewhere/SKILL.md",
      githubBlobSha: "sha",
    });

    expect((await sweepRows(t)).repos).toEqual([]);
  });

  test("includes a skill that has no stored SHA yet", async () => {
    const t = makeTest();
    await seedSkill(t, {
      source: "owner/repo",
      skillId: "fresh",
      skillMdUrl: raw("SKILL.md"),
    });

    // Eligible, so the sweep can RECORD its SHA. Whether recording also FLAGS
    // it is a separate question this query cannot answer — see the baselined
    // tests below, which is where the real guarantee lives.
    const { repos } = await sweepRows(t);
    expect(repos).toHaveLength(1);
    expect(repos[0].skills[0].githubBlobSha).toBeUndefined();
  });
});

describe("baselining a first-seen SHA", () => {
  /**
   * The bug this exists for, caught in production on the first real run.
   *
   * The caller classified a skill with no stored SHA as "record it without
   * flagging", but handed it to `applySweepResult` in the same `changed` list
   * as genuine movers — and that function flagged everything it was given.
   * Result: ~7,000 unchanged skills queued for re-download on the first sweep,
   * the exact over-flagging failure the sweep exists to avoid.
   *
   * The test that was supposed to cover this only asserted that the query
   * RETURNED such a skill. It never followed through to the write, so the two
   * halves could disagree and both look tested.
   */
  test("records the SHA without queueing a re-fetch", async () => {
    const t = makeTest();
    const skillDocId = await seedSkill(t, {
      source: "owner/repo",
      skillId: "first-seen",
      skillMdUrl: raw("SKILL.md"),
    });

    await t.mutation(internal.freshness.applySweepResult, {
      repo: "owner/repo",
      branch: "main",
      etag: 'W/"abc"',
      changed: [],
      baselined: [{ skillDocId, githubBlobSha: "sha-1" }],
    });

    const { skill, summary } = await t.run(async (ctx) => ({
      skill: await ctx.db.get(skillDocId),
      summary: await ctx.db
        .query("skillSummaries")
        .withIndex("by_skillDocId", (q) => q.eq("skillDocId", skillDocId))
        .unique(),
    }));

    // The SHA lands, on both rows...
    expect(skill!.githubBlobSha).toBe("sha-1");
    expect(summary!.githubBlobSha).toBe("sha-1");
    // ...and nothing is queued. This assertion is the whole point.
    expect(skill!.needsContentFetch).toBeUndefined();
    expect(summary!.needsContentFetch).toBeUndefined();
  });

  test("is not counted as a flagged skill", async () => {
    const t = makeTest();
    const skillDocId = await seedSkill(t, {
      source: "owner/repo",
      skillId: "first-seen",
      skillMdUrl: raw("SKILL.md"),
    });

    // The return value drives the "N skills flagged" log line and whether the
    // sweep bothers chaining into the content pipeline at all. Counting
    // baselines here would kick off a full re-fetch chain for no reason.
    const wrote = await t.mutation(internal.freshness.applySweepResult, {
      repo: "owner/repo",
      branch: "main",
      etag: undefined,
      changed: [],
      baselined: [{ skillDocId, githubBlobSha: "sha-1" }],
    });
    expect(wrote).toBe(0);
  });

  test("baselines and real changes can be applied in the same call", async () => {
    const t = makeTest();
    const mover = await seedSkill(t, {
      source: "owner/repo",
      skillId: "mover",
      skillMdUrl: raw("a/SKILL.md"),
      githubBlobSha: "old",
    });
    const fresh = await seedSkill(t, {
      source: "owner/repo",
      skillId: "fresh",
      skillMdUrl: raw("b/SKILL.md"),
    });

    // One repo routinely contains both, so the split has to survive being
    // mixed rather than only working when a batch is homogeneous.
    await t.mutation(internal.freshness.applySweepResult, {
      repo: "owner/repo",
      branch: "main",
      etag: undefined,
      changed: [{ skillDocId: mover, githubBlobSha: "new" }],
      baselined: [{ skillDocId: fresh, githubBlobSha: "sha-1" }],
    });

    const rows = await t.run(async (ctx) => ({
      mover: await ctx.db.get(mover),
      fresh: await ctx.db.get(fresh),
    }));
    expect(rows.mover!.needsContentFetch).toBe(true);
    expect(rows.fresh!.needsContentFetch).toBeUndefined();
  });
});

describe("applySweepResult", () => {
  test("flags changed skills on both rows and stores the new SHA", async () => {
    const t = makeTest();
    const skillDocId = await seedSkill(t, {
      source: "owner/repo",
      skillId: "a",
      skillMdUrl: raw("SKILL.md"),
      githubBlobSha: "old",
    });

    await t.mutation(internal.freshness.applySweepResult, {
      repo: "owner/repo",
      branch: "main",
      etag: 'W/"abc"',
      changed: [{ skillDocId, githubBlobSha: "new" }],
        baselined: [],
    });

    const { skill, summary } = await t.run(async (ctx) => ({
      skill: await ctx.db.get(skillDocId),
      summary: await ctx.db
        .query("skillSummaries")
        .withIndex("by_skillDocId", (q) => q.eq("skillDocId", skillDocId))
        .unique(),
    }));

    expect(skill!.needsContentFetch).toBe(true);
    expect(skill!.githubBlobSha).toBe("new");
    // The mirror matters: the sweep reads SHAs off summaries, so a skills-only
    // write would re-flag the same skill every single day.
    expect(summary!.needsContentFetch).toBe(true);
    expect(summary!.githubBlobSha).toBe("new");
  });

  test("stores the ETag so the next pass can ask conditionally", async () => {
    const t = makeTest();
    await t.mutation(internal.freshness.applySweepResult, {
      repo: "owner/repo",
      branch: "main",
      etag: 'W/"abc"',
      changed: [],
        baselined: [],
    });

    const state = await t.run(async (ctx) =>
      ctx.runQuery(internal.freshness.getSweepState, { repo: "owner/repo" }),
    );
    // Without this the sweep re-downloads every tree in full every day, which
    // is most of its cost saving.
    expect(state).toEqual({ branch: "main", etag: 'W/"abc"' });
  });

  test("updates rather than duplicates the state row on a second sweep", async () => {
    const t = makeTest();
    for (const etag of ['W/"one"', 'W/"two"']) {
      await t.mutation(internal.freshness.applySweepResult, {
        repo: "owner/repo",
        branch: "main",
        etag,
        changed: [],
        baselined: [],
      });
    }

    const rows = await t.run(async (ctx) =>
      ctx.db.query("repoSweepState").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].etag).toBe('W/"two"');
  });

  test("flags nothing when the changed list is empty", async () => {
    const t = makeTest();
    const skillDocId = await seedSkill(t, {
      source: "owner/repo",
      skillId: "a",
      skillMdUrl: raw("SKILL.md"),
      githubBlobSha: "same",
    });

    await t.mutation(internal.freshness.applySweepResult, {
      repo: "owner/repo",
      branch: "main",
      etag: 'W/"abc"',
      changed: [],
        baselined: [],
    });

    // The common case by a wide margin. Touching rows here would make the sweep
    // cost more than the timer it replaces.
    const skill = await t.run(async (ctx) => ctx.db.get(skillDocId));
    expect(skill!.needsContentFetch).toBeUndefined();
  });

  test("ignores a skill deleted between the read and the write", async () => {
    const t = makeTest();
    const skillDocId = await seedSkill(t, {
      source: "owner/repo",
      skillId: "a",
      skillMdUrl: raw("SKILL.md"),
      githubBlobSha: "old",
    });
    await t.run(async (ctx) => ctx.db.delete(skillDocId));

    await expect(
      t.mutation(internal.freshness.applySweepResult, {
        repo: "owner/repo",
        branch: "main",
        etag: undefined,
        changed: [{ skillDocId, githubBlobSha: "new" }],
        baselined: [],
      }),
    ).resolves.toBe(1);
  });
});
