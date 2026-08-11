/**
 * Fixtures for the instant-navigation e2e suite.
 *
 * Two strategies, deliberately:
 *
 * - **Pinned** values for direct page loads. These reuse the same slugs
 *   `lib/representative-params.ts` falls back to, so they are already
 *   load-bearing elsewhere in the app.
 *
 *   They are NOT necessarily the params Next prerenders. `representativeGitHubSkill()`
 *   returns the live top-popular skill and only falls back to these, so a test
 *   here must assert what the route's *shell* contains, never content that only
 *   exists in one URL's own prerender — otherwise it goes red the day the
 *   catalog reshuffles, against a route that is working fine.
 * - **Discovered** values for client navigations — the specs read a real link
 *   off a listing page and click it, which mirrors the actual user path and
 *   can't rot when the catalog changes.
 */

/** GitHub-sourced skill. Matches `GITHUB_FALLBACK` in lib/representative-params.ts. */
const GITHUB_SKILL = {
  org: "vercel-labs",
  repo: "skills",
  skillId: "find-skills",
} as const;

export const GITHUB_SKILL_PATH = `/${GITHUB_SKILL.org}/${GITHUB_SKILL.repo}/${GITHUB_SKILL.skillId}`;
export const GITHUB_REPO_PATH = `/${GITHUB_SKILL.org}/${GITHUB_SKILL.repo}`;
export const GITHUB_ORG_PATH = `/${GITHUB_SKILL.org}`;

/** Well-known (dotted-domain) source. Matches `WELL_KNOWN_FALLBACK`. */
const WELL_KNOWN = {
  source: "open.feishu.cn",
} as const;

export const WELL_KNOWN_SOURCE_PATH = `/site/${WELL_KNOWN.source}`;

/**
 * A public bundle to exercise `/bundle/[id]`. Not committed as a literal: bundle
 * rows are user data and differ per environment, so specs `test.skip()` when
 * it's unset rather than failing on a fork or a fresh deployment.
 */
export const BUNDLE_ID = process.env.E2E_BUNDLE_ID;

/**
 * A skill with enough recorded history to expand a diff AND pick a comparison
 * range — the History section needs three versions for both (two diffable rows,
 * and a range selector that only appears with more than one older version).
 *
 * Overridable, because which skills have history depends on what the sync has
 * actually seen in the target deployment. `skill-history.spec.ts` skips itself
 * when the page has no expandable row rather than failing, so pointing this at
 * a thin deployment degrades instead of going red.
 */
export const HISTORY_SKILL_PATH =
  process.env.E2E_HISTORY_PATH ??
  "/makieali/claude-code-engineer/architect";
