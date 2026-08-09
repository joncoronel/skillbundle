/**
 * Daily per-repo freshness sweep.
 *
 * ## What it replaces, and what it does not
 *
 * Finding out whether a skill changed used to mean downloading its SKILL.md and
 * hashing it — `markStaleContent` re-flags every row whose `contentFetchedAt` is
 * older than 7 days, so the catalog costs ~1,360 file downloads a day just to
 * discover that almost nothing moved.
 *
 * GitHub already tells us. Every entry in the recursive tree response carries a
 * blob SHA, and we now store it as `githubBlobSha` (see the field's note in
 * schema.ts). So one conditional tree call per REPO answers the question for
 * every skill in it, and only the files whose SHA actually moved get fetched.
 *
 * The catalog is ~98% GitHub sources clustering at ~6.8 skills per repo, so the
 * arithmetic works out at roughly 1,400 mostly-304 tree calls plus ~265 real
 * downloads per day — fewer downloads than today's WEEKLY cycle, at daily
 * resolution.
 *
 * ## This is an accelerator, not a replacement
 *
 * `markStaleContent` stays exactly as it is, on its 7-day cadence. This sweep
 * runs alongside it and only ever flags rows EARLIER than the timer would have.
 * That ordering matters:
 *
 *   - Well-known sources (~1.8%) have no tree to walk and are skipped here.
 *   - A repo whose tree fetch fails is skipped rather than guessed at.
 *   - A skill with no stored SHA yet is skipped until discovery gives it one.
 *   - If a content fetch fails after this flags it, the SHA has already been
 *     advanced and the sweep will not re-flag it.
 *
 * Every one of those is a gap, and the 7-day timer closes all of them. Deleting
 * it to "save" the duplicate work would trade a bounded cost for an unbounded
 * correctness hole.
 */
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  fetchRepoTree,
  indexSkillMds,
  NOT_MODIFIED,
  RATE_LIMITED,
} from "./lib/github";
import { isGitHubSource } from "./lib/source";

/** Repos inspected per action invocation before chaining. */
const REPOS_PER_BATCH = 40;
/** Rows read per page. Kept well under Convex's limits; ~6.8 skills per repo. */
const SUMMARY_PAGE = 400;

/**
 * Recover a tree path from a stored raw URL.
 *
 * `skillMdUrl` is built by `rawGitHubUrl` as
 * `https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path...}`, and the
 * tree indexes SHAs by that trailing path. Nothing else on the row records it,
 * so the URL is the only place to get it back.
 *
 * Returns null on anything that does not match the shape, which is the correct
 * outcome for a GitHub-only row pointing somewhere unexpected: skip it and let
 * the timer handle that skill.
 */
export function pathFromRawUrl(
  url: string,
): { branch: string; path: string } | null {
  const match = url.match(
    /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/([^/]+)\/(.+)$/,
  );
  // The branch used to be matched and thrown away, which is why a repo whose
  // default is neither `main` nor `master` could never be swept: both guesses
  // 404, no `repoSweepState` row is ever written, so it can never LEARN its
  // branch and is excluded forever — with its skills falling back to the
  // 30-day content timer. Discovery already resolved the real branch and baked
  // it into this very URL.
  return match ? { branch: match[1], path: match[2] } : null;
}

type SweepSkill = {
  skillDocId: Id<"skills">;
  skillId: string;
  path: string;
  githubBlobSha?: string;
};

/**
 * Whether it is safe to send `If-None-Match` for this repo on this pass.
 *
 * A 304 says "the tree has not changed since that ETag". The sweep's fast path
 * returns before any per-skill comparison, so a 304 is only safe if the pass
 * that WROTE that ETag compared every skill in the repo. Two cases where it did
 * not:
 *
 *   1. **Unbaselined skills.** A 304 cannot tell us the blob SHA of a skill we
 *      have never recorded one for.
 *
 *   2. **The page-boundary straddle.** Summaries paginate, so a repo whose
 *      skills span a boundary is visited twice in one walk. Pass A gets a 200,
 *      compares only ITS half, stores a fresh ETag. Pass B reads that ETag,
 *      sends it, 304s, and never compares the other half — permanently, because
 *      pass A always consumes the tree change first.
 *
 * `sweptAt >= runStart` IS the straddle: the only way a repo carries a sweep
 * timestamp from the current walk is that we already processed it this walk.
 *
 * Extracted and exported so the rule can be tested directly. An earlier fix
 * handled only case 1, which closes the hole while the archive backfills and
 * silently reopens it once every skill has a SHA — i.e. in exactly the steady
 * state this is meant to protect.
 */
export function shouldSendConditional(args: {
  allBaselined: boolean;
  sweptAt: number | undefined;
  runStart: number;
}): boolean {
  if (!args.allBaselined) return false;
  if (args.sweptAt !== undefined && args.sweptAt >= args.runStart) return false;
  return true;
}

/**
 * One page of live GitHub-source skills, grouped by repo.
 *
 * Paginates the `by_source_skillId` index specifically because it orders rows by
 * source, so a repo's skills arrive contiguously and grouping is free. A repo
 * straddling a page boundary is swept twice, which is cheaper than carrying
 * partial groups across invocations — see the conditional-request rule in
 * `sweepRepoFreshness` for why the second pass is not skipped by the ETag.
 */
export const listSummariesForSweep = internalQuery({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({
    repos: v.array(
      v.object({
        source: v.string(),
        /** The branch discovery resolved, recovered from the stored raw URL. */
        branch: v.optional(v.string()),
        skills: v.array(
          v.object({
            skillDocId: v.id("skills"),
            skillId: v.string(),
            path: v.string(),
            githubBlobSha: v.optional(v.string()),
          }),
        ),
      }),
    ),
    nextCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId")
      .paginate({ numItems: SUMMARY_PAGE, cursor: cursor ?? null });

    const bySource = new Map<
      string,
      { branch?: string; skills: SweepSkill[] }
    >();
    for (const s of result.page) {
      // Delisted rows are hidden everywhere and not worth a request; well-known
      // sources have no tree; a row without a resolved URL has no path to
      // compare and is still waiting on discovery.
      if (s.isDelisted) continue;
      if (!isGitHubSource(s.source)) continue;
      if (!s.skillMdUrl) continue;

      const parsed = pathFromRawUrl(s.skillMdUrl);
      if (!parsed) continue;

      const group = bySource.get(s.source) ?? { branch: parsed.branch, skills: [] };
      group.skills.push({
        skillDocId: s.skillDocId,
        skillId: s.skillId,
        path: parsed.path,
        githubBlobSha: s.githubBlobSha,
      });
      bySource.set(s.source, group);
    }

    return {
      repos: Array.from(bySource.entries()).map(([source, group]) => ({
        source,
        branch: group.branch,
        skills: group.skills,
      })),
      nextCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

/**
 * Record that a repo was checked and found unchanged.
 *
 * Separate from `applySweepResult` because the 304 path has nothing to write —
 * no SHAs moved, and the ETag we already hold is still the current one. All
 * that needs to advance is the clock, so `sweepHealth` can tell a working sweep
 * from a stalled one.
 */
export const touchSweepState = internalMutation({
  args: { repo: v.string() },
  returns: v.null(),
  handler: async (ctx, { repo }) => {
    const existing = await ctx.db
      .query("repoSweepState")
      .withIndex("by_repo", (q) => q.eq("repo", repo))
      .unique();
    // No insert on the miss path: a 304 can only happen against an ETag we
    // stored, which means the row exists. Inserting here would invent a row
    // with no branch.
    if (existing) await ctx.db.patch(existing._id, { sweptAt: Date.now() });
    return null;
  },
});

export const getSweepState = internalQuery({
  args: { repo: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      branch: v.string(),
      etag: v.optional(v.string()),
      /** Needed by the caller to detect a repo it has already seen THIS run. */
      sweptAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, { repo }) => {
    const row = await ctx.db
      .query("repoSweepState")
      .withIndex("by_repo", (q) => q.eq("repo", repo))
      .unique();
    return row
      ? { branch: row.branch, etag: row.etag, sweptAt: row.sweptAt }
      : null;
  },
});

/**
 * Record one repo's sweep: flag the skills whose blob SHA moved, and store the
 * ETag so the next pass can ask conditionally.
 *
 * The new SHA is written at the same time as the flag, NOT after the content
 * fetch succeeds. That is a deliberate trade: carrying a pending-SHA column
 * would be the precise fix, but it doubles the state for a case the 7-day timer
 * already recovers — a failed fetch sets `hasContentFetchError`, and two
 * failures re-queue discovery, which rewrites the SHA anyway.
 */
export const applySweepResult = internalMutation({
  args: {
    repo: v.string(),
    branch: v.string(),
    etag: v.optional(v.string()),
    changed: v.array(
      v.object({
        skillDocId: v.id("skills"),
        githubBlobSha: v.string(),
      }),
    ),
    /**
     * Skills whose SHA is being recorded for the FIRST time — store it, but do
     * not queue a re-fetch. Their content is already current; all that was
     * missing is the baseline to compare against next time.
     *
     * This has to be a separate list rather than a flag on `changed`, because
     * the first version of this function set `needsContentFetch: true` for
     * every entry it was handed. The caller's comment claimed baselines were
     * "recorded without flagging" but no mechanism existed to do that, so the
     * first production run queued a re-fetch of ~7,000 unchanged skills.
     */
    baselined: v.array(
      v.object({
        skillDocId: v.id("skills"),
        githubBlobSha: v.string(),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, { repo, branch, etag, changed, baselined }) => {
    const write = async (
      skillDocId: Id<"skills">,
      githubBlobSha: string,
      flag: boolean,
    ) => {
      const skill = await ctx.db.get(skillDocId);
      if (!skill) return;

      await ctx.db.patch(skillDocId, {
        githubBlobSha,
        ...(flag && { needsContentFetch: true }),
      });

      const summary = await ctx.db
        .query("skillSummaries")
        .withIndex("by_skillDocId", (q) => q.eq("skillDocId", skillDocId))
        .unique();
      if (summary) {
        await ctx.db.patch(summary._id, {
          githubBlobSha,
          ...(flag && { needsContentFetch: true }),
        });
      }
    };

    for (const b of baselined) await write(b.skillDocId, b.githubBlobSha, false);
    for (const c of changed) await write(c.skillDocId, c.githubBlobSha, true);

    const existing = await ctx.db
      .query("repoSweepState")
      .withIndex("by_repo", (q) => q.eq("repo", repo))
      .unique();
    const state = { repo, branch, etag, sweptAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, state);
    } else {
      await ctx.db.insert("repoSweepState", state);
    }

    return changed.length;
  },
});

/**
 * Walk the catalog one page of repos at a time, chaining until done.
 *
 * Self-chaining rather than looping in one action: the catalog is ~1,400 repos
 * and a single invocation would run past its time budget, the same reason
 * `backfillDiscoverUrls` chains.
 */
export const sweepRepoFreshness = internalAction({
  args: {
    cursor: v.optional(v.string()),
    /**
     * How far into the CURRENT page's repo list this invocation should start.
     *
     * A page of summaries usually yields more repos than one batch can process,
     * and the leftovers have to be resumed without advancing the cursor. An
     * earlier version re-chained on the same cursor with no offset, so every
     * invocation re-sliced the same first 40 repos and the walk never moved past
     * page one — an infinite loop that kept re-requesting the same trees from
     * GitHub. Caught in production on the first real run.
     */
    repoOffset: v.optional(v.number()),
    reposSwept: v.optional(v.number()),
    skillsFlagged: v.optional(v.number()),
    reposSkipped: v.optional(v.number()),
    /**
     * When this WALK began, carried across every chained invocation.
     *
     * Its only job is to recognise a repo we have already swept during this
     * same run, which is exactly what a page-boundary straddle looks like: the
     * repo's skills are split across two pages, so it comes round twice.
     * See the conditional-request rule below.
     */
    runStartedAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (
    ctx,
    {
      cursor,
      repoOffset = 0,
      reposSwept = 0,
      skillsFlagged = 0,
      reposSkipped = 0,
      runStartedAt,
    },
  ) => {
    const runStart = runStartedAt ?? Date.now();
    const page: {
      repos: Array<{ source: string; branch?: string; skills: SweepSkill[] }>;
      nextCursor: string;
      isDone: boolean;
    } = await ctx.runQuery(internal.freshness.listSummariesForSweep, {
      cursor: cursor ?? undefined,
    });

    const batch = page.repos.slice(repoOffset, repoOffset + REPOS_PER_BATCH);
    let swept = reposSwept;
    let flagged = skillsFlagged;
    // Cumulative like the other two. Reset per invocation, it was counted
    // against totals that span the whole chain, so the completion log mixed
    // scopes and under-reported skips by however many invocations it took.
    let skipped = reposSkipped;

    for (const repo of batch) {
      const [owner, name] = repo.source.split("/");
      if (!owner || !name) {
        skipped++;
        continue;
      }

      const state = await ctx.runQuery(internal.freshness.getSweepState, {
        repo: repo.source,
      });

      // Remembered branch first (its ETag is what we hold), then the branch
      // discovery actually resolved, then the guesses. Deduped: with
      // `state.branch === "main"` this used to be ["main","main","master"],
      // a duplicated request on the 404 path.
      const branches = [
        ...new Set(
          [state?.branch, repo.branch, "main", "master"].filter(
            (b): b is string => Boolean(b),
          ),
        ),
      ];

      // See `shouldSendConditional` for why a 304 is not always safe.
      const conditional = shouldSendConditional({
        allBaselined: repo.skills.every((s) => Boolean(s.githubBlobSha)),
        sweptAt: state?.sweptAt,
        runStart,
      });

      const tree = await fetchRepoTree(owner, name, branches, {
        etag: conditional ? state?.etag : undefined,
      });

      // GitHub cut us off. Every remaining request this run will fail the same
      // way, so stop rather than burn through the rest of the walk marking it
      // "inspected" — the walk order is stable, so continuing would starve the
      // same tail of the catalog on every recurrence.
      if (tree === RATE_LIMITED) {
        console.error(
          `Freshness sweep ABORTED on rate limit after ${swept} repos ` +
            `(${flagged} skills flagged). Remaining repos were not inspected.`,
        );
        if (flagged > 0) {
          await ctx.scheduler.runAfter(
            5_000,
            internal.skills.backfillFetchContent,
            {},
          );
        }
        return null;
      }

      // Nothing in the entire repo changed. This is the common case and the
      // whole point: no body transferred, no rate-limit cost, and every skill
      // in the repo is settled by one request.
      //
      // Still records the sweep. `sweptAt` was only written by
      // `applySweepResult`, which this path skips — so in steady state, where
      // the module budgets "~1,400 mostly-304 tree calls", almost no repo
      // advanced its timestamp. `reposSweptInLast25h` decayed toward zero and
      // `oldestSweepHoursAgo` grew without bound on a sweep that was working
      // perfectly, which is exactly the reading a STALLED chain produces — the
      // one ambiguity sweepHealth exists to remove.
      if (tree === NOT_MODIFIED) {
        swept++;
        await ctx.runMutation(internal.freshness.touchSweepState, {
          repo: repo.source,
        });
        continue;
      }

      // 404 or a repo too large for the Tree API. Leave the rows alone; the
      // content timer is the backstop for exactly this.
      if (!tree) {
        skipped++;
        continue;
      }

      swept++;

      const { shaByPath } = indexSkillMds(tree.entries);

      const changed: Array<{ skillDocId: Id<"skills">; githubBlobSha: string }> =
        [];
      const baselined: Array<{
        skillDocId: Id<"skills">;
        githubBlobSha: string;
      }> = [];

      for (const s of repo.skills) {
        const current = shaByPath.get(s.path);
        // Not in the tree: the file moved or was deleted. Discovery owns
        // re-resolving that, so don't guess at it here.
        if (!current) continue;
        // No stored SHA yet. Record the baseline WITHOUT queueing a re-fetch —
        // the content is already current, only the comparison point was
        // missing. These go in their own list precisely because putting them
        // in `changed` is what caused the first production run to queue ~7,000
        // pointless downloads.
        if (!s.githubBlobSha) {
          baselined.push({ skillDocId: s.skillDocId, githubBlobSha: current });
          continue;
        }
        if (s.githubBlobSha === current) continue;
        changed.push({ skillDocId: s.skillDocId, githubBlobSha: current });
      }

      const wrote: number = await ctx.runMutation(
        internal.freshness.applySweepResult,
        {
          repo: repo.source,
          branch: tree.branch,
          etag: tree.etag,
          changed,
          baselined,
        },
      );
      flagged += wrote;
    }

    // Where the NEXT invocation resumes. Advancing the offset is what makes a
    // same-cursor re-chain make progress instead of re-slicing the same repos.
    const nextOffset = repoOffset + batch.length;
    const pageHasMore = nextOffset < page.repos.length;

    if (pageHasMore || !page.isDone) {
      await ctx.scheduler.runAfter(
        1_000,
        internal.freshness.sweepRepoFreshness,
        {
          // Hold the cursor while finishing this page; advance it only once the
          // page's repos are exhausted, resetting the offset with it.
          cursor: pageHasMore ? (cursor ?? undefined) : page.nextCursor,
          repoOffset: pageHasMore ? nextOffset : 0,
          reposSwept: swept,
          skillsFlagged: flagged,
          reposSkipped: skipped,
          // Carried, not re-stamped: it marks the start of the WALK, and the
          // straddle check compares each repo's sweep time against it.
          runStartedAt: runStart,
        },
      );
      return null;
    }

    // Three numbers, not one. "N repos inspected" used to include 404s, 409s
    // and rate-limit bail-outs, so the single figure printed at the end could
    // not distinguish a full walk from one that failed most of its requests.
    console.log(
      `Freshness sweep complete: ${swept} repos inspected, ${skipped} skipped, ` +
        `${flagged} skills flagged for re-fetch`,
    );
    // Drain whatever the sweep queued. Safe when nothing was flagged —
    // backfillFetchContent no-ops on an empty work set.
    if (flagged > 0) {
      await ctx.scheduler.runAfter(5_000, internal.skills.backfillFetchContent, {});
    }
    return null;
  },
});

/**
 * One-command health check for the sweep. Read-only.
 *
 *   npx convex run freshness:sweepHealth --prod
 *
 * Exists because "the repo counter stopped going up" is NOT evidence the sweep
 * finished — on the first production run it meant the chain was stuck in a
 * loop, and a counter cannot tell those apart. These are the numbers that can.
 *
 * What a healthy run looks like the morning after:
 *
 *   reposSweptInLast25h  ≈ reposTracked          (the whole catalog was walked)
 *   skillsFlagged        low hundreds            (only genuine changes)
 *   skillsMissingSha     ≈ 0                     (baselines are recorded)
 *   versionsLast24h      roughly matches flagged
 *   versionsBaseline     ≈ 0 after the first day (bootstrapping is done)
 *
 * The one to watch is `skillsFlagged`. Thousands means over-flagging is back —
 * either baselining regressed or SHAs are not persisting — and that turns a
 * cost saving into a daily full-catalog re-download.
 */
export const sweepHealth = internalQuery({
  args: {},
  returns: v.object({
    reposTracked: v.number(),
    reposSweptInLast25h: v.number(),
    oldestSweepHoursAgo: v.union(v.number(), v.null()),
    skillsFlagged: v.number(),
    skillsFlaggedCapped: v.boolean(),
    versionsLast24h: v.number(),
    versionsBaseline: v.number(),
    versionsRealChange: v.number(),
    /**
     * Of a bounded sample of live skills, how many have NO archive row at all.
     *
     * Every other number here answers "did the content move?". None of them can
     * see a row that should exist and does not, because a missing row is not a
     * change — so nothing in the pipeline notices it. That was harmless while
     * rows were only ever added; `devSeed:clearSeededVersions` made deletion
     * possible, and on 2026-08-09 it was run against production by mistake and
     * removed a skill's history with nothing reporting it.
     *
     * READ THIS AS A RATE, NOT AN ALARM, UNTIL THE BACKFILL FINISHES. The
     * archive began Aug 2026 and baselines a few hundred skills a day, so most
     * of the catalog legitimately has no row yet and this starts near
     * `sampleSize`. It should fall steadily. Once it is near zero, a jump means
     * rows are being deleted or the writer is failing silently.
     */
    skillsWithNoVersions: v.number(),
    sampleSize: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    // Bounded so this stays a cheap query no matter how badly the sweep
    // misbehaves — hitting the cap is itself the signal.
    const CAP = 3000;

    const repos = await ctx.db.query("repoSweepState").collect();
    const recentCutoff = now - 25 * 60 * 60 * 1000;
    const oldest = repos.reduce<number | null>(
      (min, r) => (min === null || r.sweptAt < min ? r.sweptAt : min),
      null,
    );

    const flagged = await ctx.db
      .query("skillSummaries")
      .withIndex("by_needsContentFetch", (q) => q.eq("needsContentFetch", true))
      .take(CAP);

    const versions = await ctx.db
      .query("skillVersions")
      .withIndex("by_changedAt", (q) => q.gt("changedAt", now - DAY))
      .take(CAP);

    // Sampled, not counted. A true count is one indexed read per live skill
    // (~15k), which is both over the per-query budget and far more than a
    // health check needs — the question is "is the rate where it should be",
    // and 300 answers that to within a few percent.
    const SAMPLE = 300;
    const sample = await ctx.db
      .query("skillSummaries")
      .withIndex("by_isDelisted_lastSeenInApi", (q) =>
        q.eq("isDelisted", false),
      )
      .take(SAMPLE);
    const missing = await Promise.all(
      sample.map(async (s) => {
        const row = await ctx.db
          .query("skillVersions")
          .withIndex("by_skill_changedAt", (q) =>
            q.eq("skillDocId", s.skillDocId),
          )
          .first();
        return row === null;
      }),
    );

    return {
      reposTracked: repos.length,
      reposSweptInLast25h: repos.filter((r) => r.sweptAt >= recentCutoff).length,
      oldestSweepHoursAgo:
        oldest === null ? null : Math.round((now - oldest) / 3_600_000),
      skillsFlagged: flagged.length,
      skillsFlaggedCapped: flagged.length === CAP,
      versionsLast24h: versions.length,
      versionsBaseline: versions.filter((r) => r.isBaseline).length,
      versionsRealChange: versions.filter((r) => !r.isBaseline).length,
      skillsWithNoVersions: missing.filter(Boolean).length,
      sampleSize: sample.length,
    };
  },
});
