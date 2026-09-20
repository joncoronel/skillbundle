/**
 * URL helpers for skill detail / source pages.
 *
 * skills.sh uses two URL shapes for skills based on the source type:
 *   - GitHub (owner/repo):      /{source}/{skillId}        — no prefix
 *   - Well-known (domain.com):  /site/{source}/{skillId}   — `/site/` prefix
 *
 * The `/site/` prefix exists because well-known sources are domain names
 * containing dots, and a bare `/open.feishu.cn/...` URL would collide with
 * single-segment site routes. The prefix namespaces well-known sources
 * cleanly without changing the URL shape for GitHub-sourced skills.
 *
 * Always route through these helpers when building hrefs to a skill or its
 * source — never hard-code the path shape at call sites.
 */

/** "owner/repo" (GitHub) vs "domain.com" (well-known). Dots in the org
 *  segment indicate well-known. Mirrors the same check on the Convex side. */
export function isGitHubSource(source: string): boolean {
  const parts = source.split("/");
  return parts.length === 2 && !parts[0].includes(".");
}

/**
 * The category directory, and one category's page.
 *
 * These moved here from `lib/search-params.ts`, where `categoryHref` used to
 * return `/?cat=<key>` — the home page with a client-side filter applied. That
 * URL canonicalises to `/`, so the ~16k category chips in the skill sidebars
 * were all pointing at a page that, to a crawler, was the home page. See
 * TODO.md, "Search: the indexing gap".
 *
 * `/skills` shadows a GitHub org literally named `skills`, the same root
 * catch-all hazard `app/robots.ts`, `proxy.ts` and `RESERVED_ROOT_SEGMENTS` in
 * `lib/sitemap-entries.ts` each document a face of. It is added to that set in
 * the same change, so the sitemap never advertises a URL this route shadows.
 */
export const CATEGORIES_PATH = "/skills";

/**
 * The URL slug for a category key.
 *
 * Category KEYS are camelCase (`gameDev`, `codeReview`, `dataEngineering`)
 * because they are stored on rows, in the search index and in `?cat=` links.
 * They are not usable as path segments as they stand: a URL path is
 * case-SENSITIVE, so `/skills/gameDev` and `/skills/gamedev` are different
 * URLs and only one of them exists. Anyone linking to us by hand, and most
 * software that normalises a URL, would produce the 404 one.
 *
 * Derived, never mapped. A hand-written `{ gameDev: "game-dev" }` table is one
 * more thing to forget when a category is added, and the failure would be a
 * 404 on a page the sitemap advertises. The split is on a lower-to-upper
 * boundary, which is the only shape `CATEGORY_KEYS` contains — all 28 are
 * plain camelCase identifiers.
 *
 * The kebab form is also the better keyword: `/skills/code-review` contains
 * "code review" as two words, which is how it is searched.
 */
export const categorySlug = (key: string): string =>
  key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

export const categoryHref = (key: string): string =>
  `${CATEGORIES_PATH}/${categorySlug(key)}`;

/**
 * The home page's Category filter param key, and the URL that applies it.
 *
 * Defined here and imported BY `lib/search-params.ts`, not the other way
 * round: that module instantiates nuqs parsers at module scope and is
 * therefore client-only, so a Server Component importing it fails `next build`
 * with "Attempted to call parseAsStringLiteral() from the server" — not a type
 * error, so `pnpm check` passes and only the build catches it.
 * `lib/listing-styles.ts` carries the same warning for the same reason.
 *
 * One direction of import means one spelling of `cat`, so there is nothing to
 * keep in sync.
 */
export const CATEGORY_FILTER_KEY = "cat";

export const categoryFilterHref = (key: string): string =>
  `/?${CATEGORY_FILTER_KEY}=${key}`;

/** href for a skill's detail page. */
export function skillHref(source: string, skillId: string): string {
  return isGitHubSource(source)
    ? `/${source}/${skillId}`
    : `/site/${source}/${skillId}`;
}

/** A skill page's tabs. Each is a route, not client state. A runtime list, not
 *  just a type, so app/robots.ts can block every non-Overview tab and a new
 *  tab can't silently stay crawlable. */
export const SKILL_TAB_IDS = [
  "overview",
  "history",
  "stats",
  "security",
  "copies",
] as const;
export type SkillTab = (typeof SKILL_TAB_IDS)[number];

/** href for one tab of a skill page, given the skill's own `skillHref`. The
 *  Overview is that path itself; every other tab is a child segment. */
export function skillTabHref(skillPath: string, tab: SkillTab): string {
  return tab === "overview" ? skillPath : `${skillPath}/${tab}`;
}

/** href for a source's browse page (org for GitHub, all-skills-from-domain
 *  for well-known). */
export function sourceHref(source: string): string {
  return isGitHubSource(source) ? `/${source}` : `/site/${source}`;
}

/** href for an owner-level page — single segment (no slash). Used by the
 *  curated/official directory where each row links to a publisher's home.
 *  GitHub orgs go to bare path; well-known domains (dotted) get /site/. */
export function ownerHref(owner: string): string {
  return owner.includes(".") ? `/site/${owner}` : `/${owner}`;
}

/** Skills.sh's own page for a skill — the upstream record ours mirrors. */
export function externalSkillUrl(source: string, skillId: string): string {
  return isGitHubSource(source)
    ? `https://skills.sh/${source}/${skillId}`
    : `https://skills.sh/site/${source}/${skillId}`;
}

/** Skills.sh's external skill URL for a security audit detail. Used to
 *  link from our audit section to the upstream report. */
export function externalAuditDetailUrl(
  source: string,
  skillId: string,
  partnerSlug: string,
): string {
  return `${externalSkillUrl(source, skillId)}/security/${partnerSlug}`;
}
