import "server-only";
import { cacheLife } from "next/cache";
import { searchSkills } from "@/lib/search/typesense";
import type { SkillHit } from "@/lib/search/typesense";
import type { SkillData } from "@/components/skill-card";
import type { CategoryKey } from "@/convex/lib/categories";
import { TYPESENSE_AVAILABLE } from "@/lib/typesense-required";

/**
 * The skills on one category page.
 *
 * ── Why Typesense and not Convex ──────────────────────────────────────────
 *
 * `skillSummaries.tags` is a string ARRAY and Convex has no array-containment
 * index, so "every skill tagged `frontend`, install-sorted" has no cheap query
 * on that side. The alternatives were a new denormalized `primaryCategory`
 * column plus an index and a backfill (which also narrows the page to the
 * PRIMARY tag, when the catalog's own filter is any-of), or a precomputed
 * per-category leaderboard table on a cron. Both are real options if this page
 * ever needs to be cheaper; neither is worth building before the page has
 * proven it earns traffic.
 *
 * Typesense already indexes `tags` as a faceted `string[]`, which makes this a
 * single query — and, more importantly, makes the page agree with the home
 * page's Category filter BY CONSTRUCTION. Those two disagreeing about what is
 * in a category would be a slow, confusing bug, and they cannot here: both go
 * through `searchSkills` with the same `filters.categories`.
 *
 * ── What this adds to the build's dependencies, which is not nothing ──────
 *
 * docs/architecture.md notes that `pnpm build` already needs a reachable
 * Convex deployment. This route makes Typesense a second such dependency: the
 * 28 category pages prerender, so a PRODUCTION build with Typesense down or
 * unconfigured fails rather than degrading one page. That is the accepted cost
 * of not adding a third denormalization tier.
 *
 * Outside a production deployment it does not fail; see the next section.
 *
 * At request time the failure is softer again: `cacheLife("days")` keeps
 * serving the last entry, and `DataErrorBoundary` on the page catches a cold
 * miss.
 *
 * ── Untagged, like app/sitemap.ts ─────────────────────────────────────────
 *
 * No `cacheTag`. The catalog-wide tags (`skill-sync`, `skill-content`) fire
 * several times every morning, and a landing page listing the top 60 skills in
 * a category by installs does not change meaningfully between one sync and the
 * next. `cacheLife("days")` revalidates in the background, so a reader is
 * never blocked and the page is at most a day behind a reshuffle that moved
 * the 59th skill to 61st. Same argument the sitemap makes at length.
 */

/**
 * ── Building without Typesense ────────────────────────────────────────────
 *
 * Both loaders below run during PRERENDER, so an unconfigured engine is a
 * failed `next build`, not a degraded page. That is not hypothetical: it took
 * CI down on this branch's first run, because the e2e job has Convex and Clerk
 * secrets but no Typesense ones, and `pnpm e2e` builds the app.
 *
 * So the loaders return empty when the engine is absent. The production case
 * is handled ONE level up, at module scope in `lib/typesense-required.ts`,
 * because a throw from inside a loader is caught: `generateMetadata` has a
 * `.catch()` and the page body sits in `<DataErrorBoundary>`. An empty
 * category page in CI is correct — the render path still gets exercised, and
 * `e2e/instant-navigation.spec.ts` skips the one test that needs real rows.
 */

/**
 * How many skills a category page lists.
 *
 * Not paginated, deliberately. The page's job is to be a good landing page and
 * a good set of internal links, and both saturate well before the 1,057 skills
 * the largest category holds. Page 2 of a category would be a thin page that
 * competes with page 1 for the same query and adds 17 more URLs to a catalog
 * where 13,556 already sit uncrawled (TODO.md, "Search: the indexing gap").
 * The full list stays one click away through the Category filter on `/`.
 */
const CATEGORY_PAGE_SIZE = 60;

/**
 * A search hit, as the shared row component wants it.
 *
 * Declared field by field rather than spread: `SkillHit` carries the indexed
 * document, which is a superset of what a row renders, and spreading it would
 * ship the extra fields into the client island's props for 60 rows.
 */
function toSkillData(hit: SkillHit): SkillData {
  return {
    name: hit.name,
    source: hit.source,
    skillId: hit.skillId,
    description: hit.description,
    installs: hit.installs,
    curatedOwner: hit.curatedOwner,
    worstAuditStatus: hit.worstAuditStatus,
    hasContentFetchError: hit.hasContentFetchError,
    isGitHubOnly: hit.isGitHubOnly,
  };
}

export async function loadCategorySkills(category: CategoryKey) {
  "use cache";
  cacheLife("days");

  if (!TYPESENSE_AVAILABLE) {
    console.warn("[category-skills] Typesense not configured; no skills.");
    return { found: 0, skills: [] as SkillData[] };
  }

  const result = await searchSkills({
    // Browse, not search: `""` means "the whole catalog, filtered".
    query: "",
    sort: "installs",
    perPage: CATEGORY_PAGE_SIZE,
    filters: {
      categories: [category],
      // Forks only. A fork republishing someone else's file adds nothing to a
      // ranked list, matching `listSitemapEntries`.
      //
      // `hideGitHubOnly` was here too and is deliberately NOT: the home page's
      // Category filter defaults it off, so the "browse all N" link at the
      // bottom of this page opened a list with a different total than the one
      // it advertised. It also filtered nothing, measured on the live index
      // (frontend: 1,057 rows with and without it). A GitHub-only skill's own
      // page is already `noindex` (`skillTabMetadata`), so listing one here
      // links to a noindexed page, which is ordinary.
      hideForks: true,
    },
  });

  return {
    // `found` is the count BEFORE `perPage` truncates, so it is the honest
    // "N skills in this category" figure even though only 60 render.
    found: result.found,
    skills: result.hits.map(toSkillData),
  };
}
