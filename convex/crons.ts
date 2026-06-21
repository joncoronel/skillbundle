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

  // Daily at 07:00 UTC (one hour after syncSkills at 06:00): refresh manually-
  // added skills the leaderboard sync can't see. Updates their install count +
  // daily snapshot and keeps lastSeenInApi ahead of the 30-day delisting
  // threshold. Covers both skills below MIN_INSTALLS=50 and skills missing from
  // the all-time leaderboard at any install count (skills.sh's listing feed is
  // not exhaustive — e.g. bklit/bklit-ui at 234 installs). Self-prunes via a
  // 23h freshness filter: skills syncSkills already touched today (on the
  // leaderboard, >= 50 installs) are skipped, so the daily sync owns those and
  // this cron never double-fetches. The set is tiny (single digits to low
  // dozens), so a daily detail fetch per skill is negligible against the API
  // rate limit.
  crons.daily(
    "refresh manual skills",
    { hourUTC: 7, minuteUTC: 0 },
    internal.skills.refreshManualSkills,
    // `day` is omitted on the first invocation — the action computes it fresh and
    // only threads it through its own rate-limit reschedule.
    {},
  );
}

export default crons;
