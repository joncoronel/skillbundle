import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "sync skills",
  { hourUTC: 6, minuteUTC: 0 },
  internal.skills.syncSkills,
);

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
