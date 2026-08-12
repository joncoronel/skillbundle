// ---------------------------------------------------------------------------
// Reconcile skills the leaderboard sync doesn't maintain
// ---------------------------------------------------------------------------
//
// syncSkills only stamps skills it sees on the all-time leaderboard. A skill
// absent from that feed (a coverage gap — e.g. bklit at 234 installs, or a
// manually-added skill) stops being updated and, after 30 days unseen, gets
// auto-deleted by markDelistedSkills — even when it's a perfectly good, live
// skill. This job keeps the LIVE ones fresh and protected:
//
//   1. Find skills no sync touched in ~23h (cheap indexed summary scan).
//   2. Keep only the HEALTHY ones — working SKILL.md URL, no content-fetch
//      error, discovery not exhausted. The broke ones are genuinely dead/moved
//      upstream (install fails); leave them unstamped so the 30-day delist
//      removes them.
//   3. For each healthy one, re-fetch its install count from the v1 detail
//      endpoint (reliable for live skills), then update + snapshot + stamp
//      lastSeenInApi — the stamp is what spares it from delisting.
//
// Detail is trustworthy here precisely because we restrict to healthy skills;
// it serves stale/inflated counts only for dead/renamed ones, which fail the
// health filter. Duplicate detection is deliberately NOT done here — every
// upstream signal for it is unreliable; it's a separate Phase 2 concern.
//
// Run with { dryRun: true } to see the classification (healthy vs broke) with no
// detail calls or writes — it's derived purely from our own DB fields.

import {
  internalAction,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { revalidateSiteTag } from "./lib/revalidate";
import { appDay } from "./lib/appDay";
import { drainRefreshBatch } from "./lib/detailRefresh";
import { isDeadRenamedAlias } from "./lib/source";
import { isRefreshHealthy } from "./lib/skillHealth";
import { maxIterForRows } from "./lib/pagination";

// A skill is stale if no sync touched it in this window. MUST be under the 24h
// cron interval: the reconcile both refreshes its skills AND runs daily, so a
// skill it stamped yesterday (24h ago) has to read as stale today, or it'd only
// refresh every other day and its chart would skip days. 23h leaves a buffer
// for cron jitter while staying under 24h (a skill the 06:00 sync just stamped,
// ~1h old at 07:00, is still well within the window and correctly skipped).
const RECONCILE_FRESHNESS_MS = 23 * 60 * 60 * 1000;
// If more than this many rows look stale, syncSkills itself almost certainly
// failed/was incomplete — bail rather than hammer the detail endpoint.
const MAX_RECONCILE = 3000;
// Healthy skills refreshed per invocation; the job self-schedules a continuation
// until the stale set drains (refreshed skills are stamped fresh and drop out of
// the next scan). Keeps any single action well under Convex's time/log limits.
const RECONCILE_BATCH = 150;
// Tripwire for the dead-but-installable population (see docs/skill-lifecycle.md,
// "Dead-but-installable skills & the Fix 2 decision"). `gone` is ~0 in steady
// state, so a run with this many 404s means skills.sh dropped a batch of skills
// whose repos are still alive — the signal to revisit the fast-delist decision
// (and, at ~150, the head-of-line starvation risk documented at the batch slice).
// Self-firing so nobody has to remember to check; run devStats:countDeadButInstallable
// to quantify the standing population.
const RECONCILE_GONE_WARN = 50;

/**
 * Chain the Typesense catalog sync off this job's completion — the last step
 * of the daily pipeline whose data the search index mirrors (installs, delist
 * flags, lastSeenInApi). Chained rather than wall-clock-scheduled so the sync
 * can't race a still-running reconcile; syncCatalog's own run lock backstops
 * any remaining overlap (e.g. a manual run). Gated like cron registration
 * (CRONS_ENABLED, prod only) so a manual dev reconcile doesn't schedule a sync
 * on a deployment without Typesense env. Audit/content facets may still lag
 * their own pipeline branch by a run — they self-heal the next day.
 * Fired on the bail path too: syncing yesterday's settled data is still
 * strictly better than skipping the day (mark-and-sweep is idempotent).
 */
async function chainTypesenseSync(ctx: ActionCtx) {
  if (process.env.CRONS_ENABLED !== "true") return;
  await ctx.scheduler.runAfter(0, internal.typesense.syncCatalog, {});
}

// The per-row projection listUnseenSummaries returns and the action accumulates.
// Named once so the query's .map() and the stale[] accumulator can't drift apart
// (mirrors RefreshableSkill in lib/detailRefresh).
type UnseenSummary = {
  source: string;
  skillId: string;
  name: string;
  isDuplicate: boolean;
  hasContentFetchError: boolean;
  hasSkillMdUrl: boolean;
  discoveryFailCount: number;
  repoLiveName?: string;
  isGitHubOnly: boolean;
};

export const listUnseenSummaries = internalQuery({
  args: { cursor: v.optional(v.string()), cutoff: v.number() },
  handler: async (ctx, { cursor, cutoff }) => {
    // Indexed range: only non-delisted rows last seen before the cutoff (caller
    // pins it so the boundary is identical across pages). Same shape as
    // listStaleSummaries, just a ~23h cutoff instead of 30 days.
    const result = await ctx.db
      .query("skillSummaries")
      .withIndex("by_isDelisted_lastSeenInApi", (q) =>
        q.eq("isDelisted", false).lt("lastSeenInApi", cutoff),
      )
      .paginate(
        cursor ? { numItems: 200, cursor } : { numItems: 200, cursor: null },
      );

    const entries = result.page.map((s): UnseenSummary => ({
      source: s.source,
      skillId: s.skillId,
      name: s.name,
      isDuplicate: s.isDuplicate ?? false,
      hasContentFetchError: s.hasContentFetchError ?? false,
      hasSkillMdUrl: s.hasSkillMdUrl ?? false,
      discoveryFailCount: s.discoveryFailCount ?? 0,
      // Live "owner/repo" from rename resolution; differs from `source` when
      // this row is a dead renamed alias (the detail endpoint serves a stale
      // inflated count for those, so reconcile must not refresh from it).
      repoLiveName: s.repoLiveName,
      isGitHubOnly: s.isGitHubOnly ?? false,
    }));

    return {
      entries,
      nextCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const reconcileUnseenSkills = internalAction({
  args: {
    // Classify + log without any detail calls or writes (uses only DB fields).
    dryRun: v.optional(v.boolean()),
    // Pinned snapshot day, threaded through reschedules so a continuation/retry
    // writes into the same LA-day bucket (see syncSkills' day pinning).
    day: v.optional(v.string()),
    // Continuation guard — incremented on each self-scheduled batch.
    iteration: v.optional(v.number()),
  },
  // Explicit annotation — runQuery/runMutation into internal.* otherwise pulls
  // the whole api type into an inference cycle.
  handler: async (
    ctx,
    args,
  ): Promise<{
    dryRun: boolean;
    bailed: boolean;
    staleTotal: number;
    healthy: number;
    broke: number;
    refreshed: number;
    gone: number;
    rescheduled: boolean;
  }> => {
    const dryRun = args.dryRun ?? false;
    const day = args.day ?? appDay(Date.now() - 60 * 60 * 1000);
    const iteration = args.iteration ?? 0;
    // Pin the cutoff once so every page of the scan queries the same boundary.
    const cutoff = Date.now() - RECONCILE_FRESHNESS_MS;

    // 1. Collect the stale set (indexed scan over non-delisted rows < cutoff).
    const stale: UnseenSummary[] = [];
    let cursor: string | undefined;
    let isDone = false;
    while (!isDone) {
      const page = await ctx.runQuery(internal.reconcile.listUnseenSummaries, {
        cursor,
        cutoff,
      });
      stale.push(...page.entries);
      cursor = page.nextCursor;
      isDone = page.isDone;
      // Short-circuit: if the stale set already blew past the cap, stop paging.
      // An implausibly large stale set means syncSkills failed; the gate below
      // bails without writes, so there's no point scanning all ~N pages and
      // holding tens of thousands of rows in memory first.
      if (stale.length > MAX_RECONCILE) break;
    }

    // Refresh a stale skill only if it's healthy AND not a dead renamed alias.
    // Dead aliases (repoLiveName set and != source) are excluded because the
    // detail endpoint serves a stale, inflated count for a renamed repo's old
    // name — refreshing from it would re-introduce the qu-skills-style inflation.
    // They're duplicates of the live repo anyway; if off-board they delist.
    // GitHub-only rows are excluded for the same reason as dead aliases: the
    // detail endpoint can only 404 for them (skills.sh has never heard of the
    // skill), so a call would be pure waste — and worse, a "gone" row is never
    // stamped, so it would sit at the head of this oldest-first scan forever,
    // exactly the starvation hazard described below. Their liveness comes from
    // the content pipeline's GitHub heartbeat instead (see schema.ts).
    const healthyRows = stale.filter(
      (s) => isRefreshHealthy(s) && !isDeadRenamedAlias(s) && !s.isGitHubOnly,
    );
    // GitHub-only rows get their own bucket so they don't inflate `broke` —
    // that count feeds the "would delist" dry-run label and, together with
    // deadButInstallable, is the tripwire for the deferred Fix-2 decision
    // (docs/skill-lifecycle.md). A GitHub-only row sitting stale between
    // ~7-day heartbeats is healthy by design, not "broke".
    const githubOnlySkipped = stale.filter((s) => s.isGitHubOnly).length;
    const broke = stale.length - healthyRows.length - githubOnlySkipped;

    // 2. Safety gate: an implausibly large stale set means syncSkills broke —
    // bail rather than mass-hit the detail endpoint papering over it.
    // GitHub-only rows are excluded from the gate's count: they're
    // stale-by-design ~6 of every 7 days (heartbeat cadence), so a bulk
    // GitHub-only import could otherwise push a perfectly healthy day over
    // the cap and freeze ordinary rows toward wrongful delist.
    if (stale.length - githubOnlySkipped > MAX_RECONCILE) {
      console.error(
        `reconcileUnseenSkills: ${stale.length - githubOnlySkipped} stale rows (${stale.length} incl. ${githubOnlySkipped} github-only, which don't count toward the cap) exceed cap ${MAX_RECONCILE} — syncSkills likely failed. Bailing without writes.`,
      );
      // Not on a dry run — a diagnostic pass must never schedule real work.
      if (!dryRun) await chainTypesenseSync(ctx);
      return {
        dryRun,
        bailed: true,
        staleTotal: stale.length,
        healthy: healthyRows.length,
        broke,
        refreshed: 0,
        gone: 0,
        rescheduled: false,
      };
    }

    // Dry run: report classification only — no detail calls, no writes. Healthy
    // vs broke is derived purely from our DB fields, so this is instant.
    if (dryRun) {
      console.log(
        `reconcileUnseenSkills DRY RUN: ${stale.length} stale -> ${healthyRows.length} healthy (would refresh), ${broke} broke (would delist), ${githubOnlySkipped} github-only (skipped by design)`,
      );
      for (const s of healthyRows.slice(0, 40)) {
        console.log(`  refresh: ${s.source}/${s.skillId}`);
      }
      return {
        dryRun,
        bailed: false,
        staleTotal: stale.length,
        healthy: healthyRows.length,
        broke,
        refreshed: 0,
        gone: 0,
        rescheduled: false,
      };
    }

    // 3. Refresh up to RECONCILE_BATCH healthy skills via the detail endpoint
    // (reliable for live skills). Each gets its install count updated, a day-
    // pinned snapshot, and a lastSeenInApi stamp (which spares it from delisting).
    // Gone rows (looked healthy in our DB but 404 on detail) are left unstamped so
    // the 30-day delist removes them. How fast they stop being retried depends on
    // why detail 404s: a deleted repo also fails the SKILL.md re-fetch, so
    // markStaleContent exhausts its discovery and it flunks the health filter in
    // ~days; but a skill merely dropped from skills.sh whose repo still serves
    // SKILL.md keeps fetching fine, so it stays "healthy" and gets re-attempted
    // daily until the 30-day delist. The volume is tiny (rate-limit-trivial) and
    // the progress guard below stops a within-run spin; faster removal would be a
    // delist-policy change, not handled here.
    // Always the oldest RECONCILE_BATCH healthy rows (the scan is lastSeenInApi-
    // ascending and we re-scan from the top each continuation). Latent head-of-
    // line property to be aware of before "optimizing" this slice or the re-scan:
    // gone rows are never stamped, so they stay at the front. If 150+ persistent
    // gone-but-healthy rows ever pile up at once (a mass skills.sh off-board event
    // where the repos stay alive, so they hold "healthy" for the full 30 days),
    // they'd fill every batch and starve live rows behind them — which would then
    // freeze and wrongly delist. Pre-existing and unlikely (needs 150+ at once),
    // so not mitigated here; the fix would be giving gone rows a "tried recently"
    // sort key, which isn't worth the complexity speculatively. Tell-tale in the
    // logs: `refreshed 0, gone >=150` on repeat while live skills go stale.
    const batch = healthyRows.slice(0, RECONCILE_BATCH);
    const { refreshed, gone, rateLimitedAfter } = await drainRefreshBatch(
      ctx,
      batch,
      { day, leaderboard: "reconcile" },
    );

    if (refreshed > 0) await revalidateSiteTag("skill-sync");

    if (rateLimitedAfter !== undefined) {
      console.warn(
        `reconcileUnseenSkills rate-limited; rescheduling in ${rateLimitedAfter}s (refreshed ${refreshed} this batch)`,
      );
      await ctx.scheduler.runAfter(
        rateLimitedAfter * 1000,
        internal.reconcile.reconcileUnseenSkills,
        { day, iteration: iteration + 1 },
      );
      return {
        dryRun,
        bailed: false,
        staleTotal: stale.length,
        healthy: healthyRows.length,
        broke,
        refreshed,
        gone,
        rescheduled: true,
      };
    }

    // 4. More healthy skills than one batch? Self-schedule a fresh continuation
    // that RE-SCANS from the top (no cursor). The rows we just refreshed are
    // stamped lastSeenInApi=now, so they drop out of the < cutoff range and the
    // next scan picks up the remainder. Do NOT "optimize" this into a cursor: a
    // cursor into the < cutoff range would be invalidated by those same stamps
    // and silently skip unrefreshed rows. The iteration guard backstops an
    // unexpected non-draining loop.
    // +5 slack over the bare page count for cron jitter / re-scan churn (this job
    // re-scans from the top, so a few iterations can reprocess unstamped rows).
    const MAX_ITER = maxIterForRows(MAX_RECONCILE, RECONCILE_BATCH) + 5;
    // Only continue if this batch made progress. A batch that refreshed nothing
    // means its rows were all "gone" (404) or transient errors — none got stamped,
    // so a re-scan from the top would just hand back the same oldest rows and spin
    // to MAX_ITER re-hitting dead endpoints. Bail instead; the next daily run
    // retries them (and gone repos drain out via the discovery-failure path). This
    // is coverage-neutral: when real rows are present they refresh (refreshed > 0)
    // and we continue exactly as before.
    let rescheduled = false;
    if (refreshed > 0 && healthyRows.length > batch.length && iteration < MAX_ITER) {
      await ctx.scheduler.runAfter(0, internal.reconcile.reconcileUnseenSkills, {
        day,
        iteration: iteration + 1,
      });
      rescheduled = true;
    }

    console.log(
      `reconcileUnseenSkills: ${stale.length} stale, ${healthyRows.length} healthy; refreshed ${refreshed}, gone ${gone}, broke(skipped) ${broke}, github-only(skipped) ${githubOnlySkipped}${rescheduled ? "; rescheduled for remainder" : ""}`,
    );
    if (gone >= RECONCILE_GONE_WARN) {
      console.warn(
        `reconcileUnseenSkills: elevated gone=${gone} (>=${RECONCILE_GONE_WARN}). ` +
          `Possible dead-but-installable buildup (skills.sh dropped repos still alive). ` +
          `See docs/skill-lifecycle.md "Dead-but-installable skills & the Fix 2 decision"; ` +
          `run devStats:countDeadButInstallable to quantify.`,
      );
    }

    // Terminal exit (no continuation scheduled): the daily reconcile is done —
    // kick the Typesense catalog sync.
    if (!rescheduled) await chainTypesenseSync(ctx);

    return {
      dryRun,
      bailed: false,
      staleTotal: stale.length,
      healthy: healthyRows.length,
      broke,
      refreshed,
      gone,
      rescheduled,
    };
  },
});
