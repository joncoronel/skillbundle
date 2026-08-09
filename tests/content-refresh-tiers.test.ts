/**
 * Coverage for the two content-refresh cadences in `markStaleContentBatch`.
 *
 * These used to be one 7-day constant. They split because the daily per-repo
 * sweep (convex/freshness.ts) took over freshness for GitHub sources, and the
 * two halves then wanted opposite things:
 *
 *   - **GitHub → 30 days.** The timer is now only a backstop for the cases the
 *     sweep cannot see. Left at 7 days it would keep re-downloading the whole
 *     catalog weekly regardless, making the sweep pure added cost rather than a
 *     replacement — the entire point of the exercise.
 *   - **Well-known → 1 day.** These have no tree to walk, so the sweep skips
 *     them and this timer is their ONLY mechanism. Lengthening them alongside
 *     GitHub would have made the ~170 rows with no other freshness path the
 *     stalest in the catalog, which is backwards.
 *
 * Both directions are load-bearing and neither is obvious from reading the
 * function, so they get pinned here. Getting either backwards is silent: the
 * catalog just quietly serves older content, or quietly costs more.
 */
import { test, expect, describe } from "vitest";
import { internal } from "../convex/_generated/api";
import { makeTest } from "./_setup";

type TestHandle = ReturnType<typeof makeTest>;

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

async function seed(
  t: TestHandle,
  opts: { source: string; skillId: string; fetchedAgo: number },
) {
  const contentFetchedAt = Date.now() - opts.fetchedAgo;
  const isGitHub = opts.source.includes("/");
  await t.run(async (ctx) => {
    const skillDocId = await ctx.db.insert("skills", {
      source: opts.source,
      skillId: opts.skillId,
      name: opts.skillId,
      installs: 100,
      leaderboard: "alltime",
      lastSynced: Date.now(),
      contentFetchedAt,
      // A GitHub row only qualifies for the content path once discovery has
      // resolved a URL; without one it takes the rediscovery branch instead.
      skillMdUrl: isGitHub
        ? `https://raw.githubusercontent.com/${opts.source}/main/SKILL.md`
        : undefined,
      // Audits share this scan and would otherwise mark every row, masking
      // whether the CONTENT branch fired.
      auditFetchedAt: Date.now(),
    });
    await ctx.db.insert("skillSummaries", {
      source: opts.source,
      skillId: opts.skillId,
      name: opts.skillId,
      installs: 100,
      skillDocId,
      isDelisted: false,
      lastSeenInApi: Date.now(),
      contentFetchedAt,
      skillMdUrl: isGitHub
        ? `https://raw.githubusercontent.com/${opts.source}/main/SKILL.md`
        : undefined,
      auditFetchedAt: Date.now(),
    });
  });
}

async function scanAndCollectFlagged(t: TestHandle) {
  await t.mutation(internal.skills.markStaleContentBatch, {});
  return await t.run(async (ctx) => {
    const rows = await ctx.db.query("skillSummaries").collect();
    return rows.filter((r) => r.needsContentFetch).map((r) => r.skillId);
  });
}

// ---------------------------------------------------------------------------

describe("GitHub sources — 30-day backstop", () => {
  test("does not re-flag a skill fetched 10 days ago", async () => {
    const t = makeTest();
    await seed(t, { source: "owner/repo", skillId: "recent", fetchedAgo: 10 * DAY });

    // Under the old 7-day constant this WOULD have been flagged. Not flagging
    // it is the saving: the daily sweep already covers this skill, so a weekly
    // blanket re-download is duplicated work.
    expect(await scanAndCollectFlagged(t)).toEqual([]);
  });

  test("re-flags a skill fetched 40 days ago", async () => {
    const t = makeTest();
    await seed(t, { source: "owner/repo", skillId: "ancient", fetchedAgo: 40 * DAY });

    // Past the backstop. This is the safety net for the cases the sweep can't
    // see — chiefly a repo whose tree fetch keeps failing.
    expect(await scanAndCollectFlagged(t)).toEqual(["ancient"]);
  });

  test("does not re-flag right at 29 days", async () => {
    const t = makeTest();
    await seed(t, { source: "owner/repo", skillId: "edge", fetchedAgo: 29 * DAY });
    expect(await scanAndCollectFlagged(t)).toEqual([]);
  });
});

describe("Well-known sources — daily", () => {
  test("re-flags a skill fetched 2 days ago", async () => {
    const t = makeTest();
    await seed(t, { source: "mintlify.com", skillId: "daily", fetchedAgo: 2 * DAY });

    // No tree exists for these, so the sweep never touches them and this timer
    // is the only thing keeping them current.
    expect(await scanAndCollectFlagged(t)).toEqual(["daily"]);
  });

  test("does not re-flag a skill fetched 12 hours ago", async () => {
    const t = makeTest();
    await seed(t, { source: "mintlify.com", skillId: "fresh", fetchedAgo: 12 * HOUR });
    expect(await scanAndCollectFlagged(t)).toEqual([]);
  });
});

describe("the two tiers together", () => {
  test("a well-known row flags while an equally-aged GitHub row does not", async () => {
    const t = makeTest();
    const age = 10 * DAY;
    await seed(t, { source: "owner/repo", skillId: "gh", fetchedAgo: age });
    await seed(t, { source: "mintlify.com", skillId: "wk", fetchedAgo: age });

    // Same staleness, opposite outcomes — which is the whole point of the
    // split, and the thing a future reader is most likely to "simplify" back
    // into one constant.
    expect(await scanAndCollectFlagged(t)).toEqual(["wk"]);
  });
});
