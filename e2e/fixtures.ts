/**
 * Fixtures for the instant-navigation e2e suite.
 *
 * Two strategies, deliberately:
 *
 * - **Pinned** values for direct page loads. These reuse the same slugs
 *   `lib/representative-params.ts` falls back to, so they are already
 *   load-bearing elsewhere in the app and are the params Next prerenders at
 *   build time.
 * - **Discovered** values for client navigations — the specs read a real link
 *   off a listing page and click it, which mirrors the actual user path and
 *   can't rot when the catalog changes.
 */

/** GitHub-sourced skill. Matches `GITHUB_FALLBACK` in lib/representative-params.ts. */
export const GITHUB_SKILL = {
  org: "vercel-labs",
  repo: "skills",
  skillId: "find-skills",
} as const;

export const GITHUB_SKILL_PATH = `/${GITHUB_SKILL.org}/${GITHUB_SKILL.repo}/${GITHUB_SKILL.skillId}`;
export const GITHUB_REPO_PATH = `/${GITHUB_SKILL.org}/${GITHUB_SKILL.repo}`;
export const GITHUB_ORG_PATH = `/${GITHUB_SKILL.org}`;

/** Well-known (dotted-domain) source. Matches `WELL_KNOWN_FALLBACK`. */
export const WELL_KNOWN = {
  source: "open.feishu.cn",
  skillId: "lark-approval",
} as const;

export const WELL_KNOWN_SOURCE_PATH = `/site/${WELL_KNOWN.source}`;

/**
 * A public bundle to exercise `/bundle/[id]`. Not committed as a literal: bundle
 * rows are user data and differ per environment, so specs `test.skip()` when
 * it's unset rather than failing on a fork or a fresh deployment.
 */
export const BUNDLE_ID = process.env.E2E_BUNDLE_ID;
