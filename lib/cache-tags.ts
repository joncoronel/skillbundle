/**
 * Every `'use cache'` tag in the app, in one place.
 *
 * Deliberately dependency-free (no `server-only`, no Convex imports) so that
 * both the `cacheTag(...)` call sites and the `/api/revalidate` allowlist can
 * import it without dragging a module graph along. `lib/skill-cache.ts` has the
 * reasoning behind the skill-tag split; this module is just the vocabulary.
 *
 * `convex/lib/revalidate.ts` imports `SiteTag` from here directly — `import
 * type`, so it is erased before esbuild bundles the Convex functions and costs
 * the deployment nothing. That makes the two sides one source of truth rather
 * than a mirror. `tests/revalidate-route.test.ts` covers the runtime half by
 * asserting the route accepts exactly `SITE_TAGS`.
 */

/** Home rails, each pinged by its own leaderboard cron. */
export const HOME_POPULAR_TAG = "home-popular";
export const HOME_TRENDING_TAG = "home-trending";
export const HOME_HOT_TAG = "home-hot";

/**
 * Install counts, ranks, snapshots, version history, copies — plus the list
 * surfaces that filter on `isDelisted` or read the curated rollup. Churns
 * catalog-wide every morning by design: syncSkills rewrites the whole
 * ~9.5k-row leaderboard.
 */
export const SKILL_SYNC_TAG = "skill-sync";

/**
 * The skill row read by `loadSkill`: SKILL.md content, description, name,
 * isDelisted, curatedOwner, isGitHubOnly, and the denormalized audit verdict
 * (worstAuditStatus / worstAuditRiskLevel). Long-lived, so it depends on
 * on-demand pings rather than a timer for freshness — every writer of those
 * fields must ping this tag.
 */
export const SKILL_CONTENT_TAG = "skill-content";

/**
 * The per-skill security audit list (`loadAudits`), which is a THIRD cadence
 * again: skills.sh is re-polled at most once every 7 days per skill
 * (AUDIT_REFRESH_INTERVAL_MS), and most polls find nothing moved.
 *
 * Separate from "skill-content" even though the audit chain writes both. The
 * chain also patches a denormalized worst-status onto the skill row, so it pings
 * both — but "skill-content" is additionally pinged by five other jobs and, more
 * to the point, by the ungated daily content chain. Folding audits into it would
 * put a weekly-cadence entry back on a daily invalidation, which is the exact
 * coupling this vocabulary exists to prevent.
 *
 * Note the two are gated differently at the source: this tag fires when the
 * audit ROW moved (including a summary-text edit that leaves the verdict alone),
 * the content tag only when the rolled-up verdict moved.
 */
export const SKILL_AUDIT_TAG = "skill-audit";

/** The complete set `/api/revalidate` will accept. Order is not significant. */
export const SITE_TAGS = [
  HOME_HOT_TAG,
  HOME_TRENDING_TAG,
  HOME_POPULAR_TAG,
  SKILL_SYNC_TAG,
  SKILL_CONTENT_TAG,
  SKILL_AUDIT_TAG,
] as const;

export type SiteTag = (typeof SITE_TAGS)[number];
