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

/**
 * The home page's popular rail, pinged by the sync cron.
 *
 * Hot and Trending had tags here too, until those two moved to a client fetch
 * inside the leaderboard sheet (they render nowhere else, and the sheet starts
 * closed). Nothing renders them from a `'use cache'` function any more, so a
 * tag for them would be a ping with no reader.
 */
export const HOME_POPULAR_TAG = "home-popular";

/**
 * Install counts, ranks, snapshots, version history, copies — plus the list
 * surfaces that filter on `isDelisted` or read the curated rollup. Churns
 * catalog-wide every morning by design: syncSkills rewrites the whole
 * ~16k-row leaderboard.
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

/** The complete set `/api/revalidate` will accept. Order is not significant. */
export const SITE_TAGS = [
  HOME_POPULAR_TAG,
  SKILL_SYNC_TAG,
  SKILL_CONTENT_TAG,
] as const;

export type SiteTag = (typeof SITE_TAGS)[number];
