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

  // Daily at 07:00 UTC (one hour after syncSkills at 06:00, after syncCurated at
  // 06:30): reconcile skills the leaderboard sync doesn't maintain. Refreshes
  // the install count of every HEALTHY skill no sync touched in ~26h (coverage-
  // gap and manually-added skills) and stamps lastSeenInApi so they aren't
  // wrongly delisted; leaves broke/dead skills to the 30-day delist. Self-
  // schedules in batches until the stale set drains, and bails if the stale set
  // is implausibly large (a sign syncSkills itself failed).
  crons.daily(
    "reconcile unseen skills",
    { hourUTC: 7, minuteUTC: 0 },
    internal.skills.reconcileUnseenSkills,
    // `day`/`iteration` omitted on the first invocation — computed fresh and
    // only threaded through the action's own reschedules.
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
}

export default crons;
