import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Crons run on every deployment they're registered in, and Convex usage is
// billed at the team level — so running the full sync + leaderboard refresh on
// the dev deployment as well as prod just doubles bandwidth, storage churn, and
// external embedding (Voyage) costs for no benefit. Gate registration behind
// CRONS_ENABLED (set to "true" on the PRODUCTION deployment only). Env vars in
// cron definitions are evaluated at deploy time, so dev deploys register no
// crons at all. When you need fresh data locally, run a sync on demand, e.g.
// `npx convex run skills:syncSkills`.
if (process.env.CRONS_ENABLED === "true") {
  // Daily at 04:00 UTC: per-repo freshness sweep (convex/freshness.ts).
  //
  // Asks GitHub's Tree API, once per repo and conditionally, which SKILL.md
  // blob SHAs moved, and flags only those for re-fetch. Because ~98% of the
  // catalog is GitHub at ~6.8 skills per repo, that costs ~1,400 mostly-304
  // tree calls plus ~265 downloads — fewer file downloads than the 7-day timer
  // does, at daily resolution instead of weekly.
  //
  // Runs two hours ahead of syncSkills so a full walk (self-chaining across
  // ~1,400 repos) and the content fetch it queues both settle before the 06:00
  // chain starts competing for the same work set.
  //
  // It ACCELERATES `markStaleContent`, it does not replace it — see the header
  // in freshness.ts for the gaps the 7-day timer still has to cover.
  crons.daily(
    "sweep repo freshness",
    { hourUTC: 4, minuteUTC: 0 },
    internal.freshness.sweepRepoFreshness,
    {},
  );

  // Hourly: pull a fresh Vercel OIDC token from the site relay for the
  // skills.sh API (convex/skillsAuth.ts).
  //
  // Hourly because the runtime token lives TWO hours, not the ~12 the Vercel
  // docs state. Measured Aug 12 2026 against a real deployment: `exp - iat` is
  // exactly 2h, and the token is minted fresh per request, so each refresh gets
  // a full window. (The 12h figure does hold for the token `vercel env pull`
  // writes for local dev, which is probably where the docs' number comes from.
  // Don't size this cron off a locally pulled token.)
  //
  // At hourly, a token always has ~1h of life left when the next refresh lands,
  // so one failed refresh still can't strand us. A 6h cron against a 2h token
  // would have left us on the fallback key two hours in every six.
  //
  // A failure here is not an outage: the calls fall back to the legacy
  // SKILLS_SH_API_KEY, and /dev surfaces that we're running on it.
  crons.hourly(
    "refresh skills.sh OIDC token",
    { minuteUTC: 20 },
    internal.skillsAuth.refreshToken,
    {},
  );

  // Daily at 06:00 UTC: full sync. syncSkills walks the v1 listing endpoint,
  // upserts presence + installs, schedules markDelistedSkills, then chains
  // markStaleContent which re-flags rows older than 7 days for re-fetch and
  // kicks off the discovery + content-fetch chain (raw fetch for GitHub,
  // v1 detail for well-known). Embeddings and stats run when the chain drains.
  crons.daily(
    "sync skills",
    { hourUTC: 6, minuteUTC: 0 },
    internal.skills.syncSkills,
  );

  // Daily at 06:30 UTC: refresh the curated/official set. Small (~340 skills),
  // fast, and changes infrequently. Stamps `curatedOwner` for the verified
  // badge and powers the /official page.
  crons.daily(
    "sync curated",
    { hourUTC: 6, minuteUTC: 30 },
    internal.curated.syncCurated,
  );

  // Daily at 06:45 UTC (after the sync has appended today's snapshots): drop
  // snapshot rows past the retention window so skillSnapshots stays flat instead
  // of growing ~1 row/skill/day forever. Batches itself via an action loop.
  crons.daily(
    "prune skill snapshots",
    { hourUTC: 6, minuteUTC: 45 },
    internal.skills.pruneSnapshots,
  );

  // Hourly: trending leaderboard. Trending shifts within hours; hourly is
  // the natural cadence for a "trending this week" rail.
  crons.hourly(
    "sync trending",
    { minuteUTC: 15 },
    internal.leaderboards.syncTrending,
  );

  // Every 30 min: hot view. The API explicitly compares the current hour to
  // the same hour yesterday, so refreshing more than every 30 min just
  // re-renders the same delta — but staler than that and the rail goes flat.
  crons.cron(
    "sync hot",
    "0,30 * * * *",
    internal.leaderboards.syncHot,
  );

  // Daily at 05:00 UTC: housekeeping for the GitHub tree cache shared by the
  // skill sync (discoverSkillMdUrls) and the repo-recommendation flow.
  crons.daily(
    "cleanup github tree cache",
    { hourUTC: 5, minuteUTC: 0 },
    internal.githubCache.cleanupExpiredCache,
  );

  crons.daily(
    "cleanup expired fingerprint cache",
    { hourUTC: 5, minuteUTC: 5 },
    internal.recommendations.cleanupExpiredFingerprintCache,
  );

  // Daily at 07:00 UTC (one hour after syncSkills at 06:00, after syncCurated at
  // 06:30): reconcile skills the leaderboard sync doesn't maintain. Refreshes
  // the install count of every HEALTHY skill no sync touched in ~23h (coverage-
  // gap and manually-added skills) and stamps lastSeenInApi so they aren't
  // wrongly delisted; leaves broke/dead skills to the 30-day delist. Self-
  // schedules in batches until the stale set drains, and bails if the stale set
  // is implausibly large (a sign syncSkills itself failed).
  crons.daily(
    "reconcile unseen skills",
    { hourUTC: 7, minuteUTC: 0 },
    internal.reconcile.reconcileUnseenSkills,
    // `day`/`iteration` omitted on the first invocation — computed fresh and
    // only threaded through the action's own reschedules.
    {},
  );

  // The Typesense catalog sync is primarily chained off reconcileUnseenSkills'
  // completion (see reconcile.ts chainTypesenseSync) so it indexes settled
  // installs/delist flags instead of racing the pipeline. Mark-and-sweep — see
  // typesense.syncCatalog.
  //
  // This daily wall-clock run is the BACKSTOP: Convex doesn't retry actions, so
  // if reconcile throws mid-flight its chain link never fires and nothing syncs
  // that day. Bounds worst-case staleness to ~24h instead of "until reconcile
  // succeeds again". syncCatalog's run lock makes any overlap with the chained
  // run a no-op, so this costs nothing on a normal day. Scheduled at 09:00 UTC
  // — comfortably after the ~07:00 reconcile chain has run on a healthy day.
  crons.daily(
    "typesense sync backstop",
    { hourUTC: 9, minuteUTC: 0 },
    internal.typesense.syncCatalog,
    {},
  );

  // Weekly Sunday 08:00 UTC: resolve GitHub repo identities for duplicate/rename
  // detection (Phase 2). Stamps githubRepoId + repoLiveName onto summaries so
  // getSkillCopies can group aliases (same repo id) and forks (same content,
  // different id). Per-repo cached + self-scheduling; weekly is plenty since
  // repos rarely rename and new skills are few.
  crons.weekly(
    "resolve repo identities",
    { dayOfWeek: "sunday", hourUTC: 8, minuteUTC: 0 },
    internal.duplicates.resolveRepoIdentities,
    {},
  );

  // Weekly Sunday 09:00 UTC (after repo-identity resolution at 08:00, so the
  // dead-alias skip has fresh repoLiveName): refresh curated-only skills — the
  // ones never on the leaderboard, whose install count + snapshots syncCurated
  // can't supply. Detail-refreshes the healthy ones so their count stays current
  // and their install chart fills in. Self-scheduling; tiny incremental load.
  crons.weekly(
    "refresh curated skills",
    { dayOfWeek: "sunday", hourUTC: 9, minuteUTC: 0 },
    internal.curatedRefresh.refreshCuratedSkills,
    {},
  );

  // Weekly Sunday 10:00 UTC: re-resolve repo identities that have gone stale
  // (resolvedAt older than RERESOLVE_TTL_MS). resolveRepoIdentities only stamps
  // never-resolved repos, so a repo that renames AFTER being stamped would keep a
  // stale repoLiveName forever — its old name never recognized as a dead alias,
  // never delisting, possibly re-inflated by reconcile. This re-checks aged repos
  // against GitHub and re-stamps their summaries when the identity moved. Cheap
  // in steady state (only repos past the TTL); self-scheduling + rate-limit aware.
  //
  // Timing note: the 2h gap after resolve (08:00) is load-bearing. Both jobs can
  // chain a full computeCopyCounts (resolve always; this one only when a repo id
  // actually moved). If resolve's pass were still draining when this fires AND an
  // id changed, two full-catalog recomputes would overlap — wasted, not wrong
  // (computeCopyCounts is idempotent). The ~12.5k-row pass drains in minutes, so
  // a 2h gap is ample; if the catalog grows enough that it doesn't, widen the gap.
  crons.weekly(
    "re-resolve stale repo identities",
    { dayOfWeek: "sunday", hourUTC: 10, minuteUTC: 0 },
    internal.duplicates.reresolveStaleRepoIdentities,
    {},
  );
}

export default crons;
