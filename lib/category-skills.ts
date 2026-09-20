import "server-only";
import { cacheLife } from "next/cache";
import { searchSkills } from "@/lib/search/typesense";
import type { SkillHit } from "@/lib/search/typesense";
import type { SkillData } from "@/components/skill-card";
import type { CategoryKey } from "@/convex/lib/categories";

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
 * 28 category pages prerender, so a Typesense outage during a build fails the
 * build rather than degrading one page. That is the accepted cost of not
 * adding a third denormalization tier, and it is worth knowing before anyone
 * debugs a red build that has nothing to do with their change.
 *
 * At request time the failure is softer: `cacheLife("days")` keeps serving the
 * last entry, and `DataErrorBoundary` on the page catches a cold miss.
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
 * How many skills a category page lists.
 *
 * Not paginated, deliberately. The page's job is to be a good landing page and
 * a good set of internal links, and both saturate well before the 1,057 skills
 * the largest category holds. Page 2 of a category would be a thin page that
 * competes with page 1 for the same query and adds 17 more URLs to a catalog
 * where 13,556 already sit uncrawled (TODO.md, "Search: the indexing gap").
 * The full list stays one click away through the Category filter on `/`.
 */
export const CATEGORY_PAGE_SIZE = 60;

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

  const result = await searchSkills({
    // Browse, not search: `""` means "the whole catalog, filtered".
    query: "",
    sort: "installs",
    perPage: CATEGORY_PAGE_SIZE,
    filters: {
      categories: [category],
      // The same two exclusions `listSitemapEntries` applies, for the same
      // reasons: a fork republishing someone else's file adds nothing to a
      // ranked list, and a GitHub-only skill is unreviewed (see
      // convex/skills.ts). A landing page is an editorial claim about what is
      // worth installing, so it should not be the one surface that forgets
      // them.
      hideForks: true,
      hideGitHubOnly: true,
    },
  });

  return {
    // `found` is the count BEFORE `perPage` truncates, so it is the honest
    // "N skills in this category" figure even though only 60 render.
    found: result.found,
    skills: result.hits.map(toSkillData),
  };
}
