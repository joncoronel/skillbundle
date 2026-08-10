"use client";

import Link from "next/link";
import { Button } from "@/components/ui/cubby-ui/button";

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
    <div className="mx-auto max-w-2xl px-4 pt-24 pb-24">
      <p className="font-mono text-xs text-muted-foreground mb-8 tabular-nums">
        500 INTERNAL_ERROR
      </p>

      <h1 className="font-display text-[clamp(2.5rem,6vw,4rem)] font-medium tracking-tight leading-hero text-balance mb-6">
        That didn&apos;t load.
      </h1>

      <p className="text-base text-muted-foreground leading-relaxed mb-10 max-w-md">
        Something broke while fetching this page. It&apos;s usually temporary —
        try again, or head back and take another route.
      </p>

      <div className="flex flex-wrap gap-3">
        <Button onClick={() => retry()}>Try again</Button>
        <Button variant="outline" nativeButton={false} render={<Link href="/" />}>
          Back home
        </Button>
      </div>

      {error.digest ? (
        <p className="font-mono text-xs text-muted-foreground/70 mt-10 tabular-nums">
          Error ID: {error.digest}
        </p>
      ) : null}
    </div>
  );
}
