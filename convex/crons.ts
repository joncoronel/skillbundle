import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

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

export default crons;
