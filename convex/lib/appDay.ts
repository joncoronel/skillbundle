// Snapshot day-keying in a fixed app timezone, shared by syncSkills, the
// reconcile/curated-refresh jobs, and the insights history cutoffs.
//
// We attribute install snapshots to a fixed calendar day so a daily counter
// sample lands in one bucket. Because we sample a cumulative counter rather than
// raw events, we can't re-bucket per viewer later, so the calendar day is chosen
// at write time. The cron runs at 06:00 UTC (~11pm LA), so it samples near the
// END of the LA day it labels — "Jun 17" carries Jun 17's installs. Tradeoff:
// every viewer sees LA-calendar dates; other zones' local days won't line up.
export const APP_TIMEZONE = "America/Los_Angeles";

/**
 * Calendar day ("YYYY-MM-DD") in APP_TIMEZONE, for snapshot keying and
 * history/retention cutoffs. en-CA yields a YYYY-MM-DD string; the `timeZone`
 * option handles DST automatically. Same-day re-runs hit the same row, and the
 * install-owning jobs pin this once per run (the `day` arg on upsertSkillsBatch)
 * so a run crossing LA midnight — only ~1–2h after the 06:00 UTC start — can't
 * split a run across two buckets.
 */
export function appDay(ts: number): string {
  return new Date(ts).toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE });
}
