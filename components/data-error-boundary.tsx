"use client";

import { catchError, type ErrorInfo } from "next/error";
import { Button } from "@/components/ui/cubby-ui/button";

/**
 * Region-level error boundary for the Convex-backed data sections.
 *
 * Why this exists alongside `app/(main)/error.tsx`: that boundary replaces the
 * whole page. These regions are the parts of a page that can fail on their own
 * — a listing, a skill body, a bundle — while the surrounding chrome
 * (breadcrumb, title, actions) is static and perfectly fine. Wrapping just the
 * region keeps the page usable and scopes the retry to the thing that broke.
 *
 * Place it *around* an existing `<Suspense>`, not inside it, so the boundary
 * covers both the fallback and the resolved children.
 *
 * `retry()` re-fetches and re-renders the boundary's children, including any
 * Server Components — which is the whole point here, since the failure mode is
 * a Convex read throwing on the server. (`reset()` would only clear client
 * state and re-render the same failed tree.)
 *
 * Note the unusual fallback signature: `(props, errorInfo)` — two positional
 * arguments, not one props object.
 */
function DataErrorFallback(
  { label }: { label: string },
  { error, retry }: ErrorInfo,
) {
  const digest =
    error instanceof Error
      ? (error as Error & { digest?: string }).digest
      : undefined;

  return (
    <div className="rounded-2xl border border-dashed dark:border-border/50 px-4 py-10 text-center">
      <p className="text-sm font-medium mb-1">Couldn&apos;t load {label}.</p>
      <p className="text-sm text-muted-foreground mb-5">
        This is usually temporary.
      </p>
      <Button variant="outline" size="sm" onClick={() => retry()}>
        Try again
      </Button>
      {digest ? (
        <p className="font-mono text-xs text-muted-foreground/60 mt-5 tabular-nums">
          {digest}
        </p>
      ) : null}
    </div>
  );
}

export const DataErrorBoundary = catchError(DataErrorFallback);
