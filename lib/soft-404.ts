import type { Metadata } from "next";

/**
 * The `robots` value for a catalog page whose subject does not exist.
 *
 * ── Why this is needed at all ─────────────────────────────────────────────
 *
 * The catalog routes (`/[org]`, `/[org]/[repo]`, `/site/[source]`) call
 * `notFound()` from INSIDE their Suspense boundary, below the prerendered App
 * Shell — see e.g. `app/(main)/[org]/page.tsx`. By the time that runs, the
 * shell has already been streamed and the response has committed with HTTP
 * 200. So the status code cannot be 404, and every unmatched root-level URL
 * answers 200 with not-found content. Verified against production:
 * `curl -o /dev/null -w '%{http_code}' https://skillbundle.dev/privacy` returned
 * 200 before `/privacy` was a real page.
 *
 * That is a soft 404, and it is inherent to the instant-navigation
 * architecture, not a bug to fix here. Moving the check above the boundary
 * would empty the shared App Shell and make every client navigation into these
 * routes blocking, which is precisely what `docs/architecture.md` §1 and
 * `e2e/instant-navigation.spec.ts` exist to prevent. The status code is not
 * worth that trade.
 *
 * ── Why `generateMetadata` CAN fix it when the page cannot ────────────────
 *
 * `generateMetadata` runs OUTSIDE every boundary and resolves before the shell
 * commits, so a `<meta name="robots">` it emits does land in the document head.
 * `noindex` is the signal Google actually acts on for this case: it removes the
 * page from the index outright, where a soft-404 classification only declines
 * to add it and reports the URL as an error against the property. `nofollow`
 * comes with it because a page that does not exist has no links worth crawling
 * out of, and the catalog is ~16k pages deep.
 *
 * Each of the three routes already has a not-found branch in its
 * `generateMetadata`; this is the value those branches return. Keep it shared
 * so a fourth catalog route cannot quietly ship without it.
 */
export const NOT_FOUND_ROBOTS: Metadata["robots"] = {
  index: false,
  follow: false,
};
