import "server-only";
import { cacheLife } from "next/cache";
import { listFacetCounts } from "@/lib/search/typesense";
import {
  CATEGORY_KEYS,
  isCategoryKey,
  type CategoryKey,
} from "@/convex/lib/categories";

/**
 * How many skills each category holds, for the `/skills` hub.
 *
 * One faceted Typesense request for all 28, not 28 requests — a facet count is
 * exactly this query, and the home page's Category filter already reads the
 * same one. Same filters as `loadCategorySkills`, so a category's count on the
 * hub and the "N skills" on its own page describe the same set. Two figures
 * that should agree and are computed by different rules is how a page starts
 * quietly lying.
 *
 * Returns every key, including ones the facet does not mention: an absent
 * facet value means zero, and the hub still lists the category. A category the
 * model has not used yet is a real, navigable page (see the empty state on
 * `/skills/[category]`), so dropping it here would make the hub and the route
 * table disagree.
 */
export async function loadCategoryCounts(): Promise<
  Record<CategoryKey, number>
> {
  "use cache";
  cacheLife("days");

  const counts = await listFacetCounts("tags", {
    scope: {
      query: "",
      searchDescriptions: false,
      filters: { hideForks: true, hideGitHubOnly: true },
    },
  });

  const byKey = Object.fromEntries(
    CATEGORY_KEYS.map((key) => [key, 0]),
  ) as Record<CategoryKey, number>;

  for (const { value, count } of counts) {
    // `tags` is a free-form string[] in the index, so a stale row can still
    // carry a key that has since been removed from CATEGORY_LABELS (the
    // re-tag after a CATEGORIES_VERSION bump is not instant). Guarding here
    // keeps a retired key out of the record rather than widening its type.
    if (isCategoryKey(value)) byKey[value] = count;
  }

  return byKey;
}
