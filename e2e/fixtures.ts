/**
 * Shared route params for the signed-out e2e suites (instant-navigation,
 * landmarks, skill-history).
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
 * A skill's HISTORY TAB (`/{source}/{skillId}/history` — the timeline moved
 * off the overview and onto its own route) with enough recorded history to
 * expand a diff AND pick a comparison range: three versions covers both (two
 * diffable rows, and a range selector that only appears with more than one
 * older version).
 *
 * Overridable, because which skills have history depends on what the sync has
 * actually seen in the target deployment. `skill-history.spec.ts` skips itself
 * when the page has no expandable row rather than failing, so pointing this at
 * a thin deployment degrades instead of going red.
 *
 * That graceful skip is also how this pin went stale without anyone noticing.
 * It pointed at `makieali/claude-code-engineer/architect`, which carries a
 * single baseline row in production: the page loads, there is nothing to
 * expand, and all three tests skip. A green run said the app's most
 * interactive surface was covered when it was not being exercised at all.
 * When changing this, check the target has at least THREE versions, and
 * confirm the suite reports 3 passed rather than 3 skipped.
 */
export const HISTORY_SKILL_PATH =
  process.env.E2E_HISTORY_PATH ?? "/pbakaus/impeccable/impeccable/history";

/**
 * A skill with copies — aliases (the same repo under another name) or forks (a
 * different repo publishing identical content) — for the Copies tab.
 *
 * Env-only, with no pinned default, unlike every other fixture here. Copies are
 * not a property of a skill, they are a property of the CATALOG: they exist
 * only after the weekly duplicate chain has resolved repo identities, and most
 * deployments have none at all. A pinned slug would go red on a fresh or
 * dev-seeded deployment for a tab that is working correctly, and the tab itself
 * only renders for skills that have copies — so `skill-copies.spec.ts` skips
 * rather than fails when this is unset.
 *
 * Point it at the skill PAGE (no `/copies` suffix); the spec navigates.
 *
 * The leading slash is optional. Git Bash rewrites a leading `/` in an env
 * value into a Windows path (`E2E_COPIES_PATH=/org/repo/skill` arrives as
 * `C:/Program Files/Git/org/repo/skill`), so on Windows the natural way to
 * write this is without one.
 */
const copiesPath = process.env.E2E_COPIES_PATH?.trim();
export const COPIES_SKILL_PATH = copiesPath
  ? copiesPath.startsWith("/")
    ? copiesPath
    : `/${copiesPath}`
  : undefined;
