"use client";

import { RouteErrorBody } from "@/components/route-error-body";

/**
 * Segment boundary for every user-facing page: home, compare, official,
 * pricing, add, dashboard, settings, the catalog routes, and bundle.
 *
 * Placed at `(main)` rather than `app/` deliberately. `error.js` does not wrap
 * the layout in its own segment, so a root `app/error.tsx` still would not
 * cover the root layout — that is `app/global-error.tsx`'s job. Sitting here
 * means this renders *inside* `(main)/layout.tsx`, so AppHeader and the bundle
 * bar survive and the user can navigate away instead of hitting a dead page.
 *
 * `retry()` over `reset()`: the realistic failure here is a Convex read
 * throwing during a server render, and only retry() re-runs Server Components.
 * reset() would just re-render the same failed tree.
 *
 * Note this file stays a plain default export — do NOT wrap it in `catchError`.
 * The error.js convention already renders inside a Next-provided boundary;
 * catchError is for adding *extra* boundaries at component level, which is what
 * components/data-error-boundary.tsx does.
 */
export default function MainError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <RouteErrorBody
      error={error}
      retry={retry}
      description="This page failed to load. It's usually temporary. Try again, or go back home."
    />
  );
}
