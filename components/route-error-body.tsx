"use client";

import Link from "next/link";
import { Button } from "@/components/ui/cubby-ui/button";

/** Stable ref callback — see the note on the element below. */
function focusOnMount(node: HTMLElement | null) {
  node?.focus();
}

/**
 * The shared body for the segment error boundaries — `app/(main)/error.tsx` and
 * `app/(auth)/error.tsx`.
 *
 * Extracted rather than copy-pasted so the two cannot drift into showing a user
 * two different products for the same condition. `app/global-error.tsx` does
 * NOT use it: that one renders its own document without the app stylesheet, so
 * it has to be inline-styled and cannot share Tailwind markup.
 *
 * A `<div>`, not a `<main>`, and that changed: `(main)/layout.tsx` now owns the
 * landmark for its whole group, so rendering one here would nest two visible
 * `<main>`s on every error in that group. `(auth)` has no layout landmark, so
 * `(auth)/error.tsx` supplies one around this instead — see the note there.
 *
 * It keeps the focus target either way, and owns its own box for both callers —
 * neither boundary should re-wrap it, or the two render at different widths.
 *
 * The focus move matters because this swaps the page body underneath whatever
 * chrome survives, which differs by group: in `(main)` the header stays, in
 * `(auth)` there is none. Either way nothing announces the change on its own.
 */
export function RouteErrorBody({
  error,
  retry,
  description,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  /** One sentence naming what failed and the way out. */
  description: string;
}) {
  return (
    <div
      // A stable callback, not an inline arrow: an inline one is a new function
      // on every render, so React detaches and re-runs it each time and the
      // boundary would re-steal focus mid-interaction. Rare here, but free to
      // get right.
      ref={focusOnMount}
      tabIndex={-1}
      className="mx-auto max-w-2xl px-4 pt-24 pb-24 outline-none"
    >
      <p className="mb-8 font-mono text-xs text-muted-foreground tabular-nums">
        500 INTERNAL_ERROR
      </p>

      <h1 className="mb-6 text-hero">Something went wrong.</h1>

      <p className="mb-10 max-w-md text-base leading-relaxed text-muted-foreground">
        {description}
      </p>

      <div className="flex flex-wrap gap-3">
        <Button onClick={() => retry()}>Try again</Button>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/" />}
        >
          Back home
        </Button>
      </div>

      {/* Labelled and at full muted contrast: this is the string a user is
          asked to quote in a bug report, so it should not be the least legible
          thing on the page. */}
      {error.digest ? (
        <p className="mt-10 font-mono text-xs text-muted-foreground tabular-nums">
          Error ID: {error.digest}
        </p>
      ) : null}
    </div>
  );
}
