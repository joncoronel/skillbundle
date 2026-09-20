import "server-only";
import { isTypesenseConfigured } from "@/lib/search/typesense";
import { IS_PRODUCTION_DEPLOYMENT } from "@/lib/deployment-env";

/**
 * Fail a production build that has no search engine, before anything can
 * catch it.
 *
 * The `/skills` loaders both run during prerender, and both of their call
 * sites swallow errors: `generateMetadata` has a `.catch()`, and the page
 * bodies sit inside `<DataErrorBoundary>`. So a throw from inside a loader
 * does not fail the build, it prerenders 28 error pages and 28 zeroed hub
 * tiles, which then sit behind a day-long cache. That is the opposite of the
 * loud failure the loaders' comments promised.
 *
 * A module-scope throw is the fix, and the precedent is `lib/site-url.ts`,
 * which guards its own silent-artifact failure the same way: nothing wraps a
 * module evaluation, so this reaches the build.
 *
 * Outside a production deployment it stays quiet on purpose. CI has no
 * Typesense secrets, fork PRs never get them, and a fresh clone has none, so
 * those builds return empty and the two `/skills` e2e specs skip.
 */
if (IS_PRODUCTION_DEPLOYMENT && !isTypesenseConfigured()) {
  throw new Error(
    "Typesense is not configured on a production deployment. The /skills " +
      "category pages prerender from it, so this build would ship 28 empty " +
      "landing pages. Set NEXT_PUBLIC_TYPESENSE_HOST / _SEARCH_KEY / _COLLECTION.",
  );
}

/**
 * True when the loaders should query. False only outside production, where the
 * guard above has already decided an empty page is acceptable.
 */
export const TYPESENSE_AVAILABLE = isTypesenseConfigured();
