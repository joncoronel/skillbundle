import type { Metadata } from "next";

/**
 * The `robots` value for a catalog page whose subject does not exist.
 *
 * These routes call `notFound()` inside their Suspense boundary, below the
 * prerendered shell, so the response has already committed with HTTP 200 and
 * the status cannot be 404. That is inherent to the instant-navigation
 * architecture (docs/architecture.md §1), not a bug to fix here.
 *
 * Next already injects a late `noindex` when the not-found branch renders. This
 * adds `nofollow`, and emits both from `generateMetadata`, which resolves before
 * the shell commits rather than partway through the stream. Shared so a fourth
 * catalog route cannot ship without it.
 */
export const NOT_FOUND_ROBOTS: Metadata["robots"] = {
  index: false,
  follow: false,
};
