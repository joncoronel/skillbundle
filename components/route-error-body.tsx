"use client";

import Link from "next/link";
import { Button } from "@/components/ui/cubby-ui/button";

/**
 * The shared body for the segment error boundaries — `app/(main)/error.tsx` and
 * `app/(auth)/error.tsx`.
 *
 * Extracted rather than copy-pasted so the two cannot drift into showing a user
 * two different products for the same condition. `app/global-error.tsx` does
 * NOT use it: that one renders its own document without the app stylesheet, so
 * it has to be inline-styled and cannot share Tailwind markup.
 *
 * `<main>` with a focus target, because this replaces the whole page body while
 * the layout's header stays. Neither group layout supplies a landmark, so
 * without it a screen-reader user gets no signal the content changed and no
 * landmark to jump to.
 */
function focusOnMount(node: HTMLElement | null) {
  node?.focus();
}

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
    <main
      // A stable callback, not an inline arrow: an inline one is a new function
      // on every render, so React detaches and re-runs it each time and the
      // boundary would re-steal focus mid-interaction. Rare here, but free to
      // get right.
      ref={focusOnMount}
      tabIndex={-1}
      className="mx-auto max-w-2xl px-4 pt-24 pb-24 outline-none"
    >
      <p className="font-mono text-xs text-muted-foreground mb-8 tabular-nums">
        500 INTERNAL_ERROR
      </p>

      <h1 className="font-display text-[clamp(2.5rem,6vw,4rem)] font-medium tracking-tight leading-hero text-balance mb-6">
        Something went wrong.
      </h1>

      <p className="text-base text-muted-foreground leading-relaxed mb-10 max-w-md">
        {description}
      </p>

      <div className="flex flex-wrap gap-3">
        <Button onClick={() => retry()}>Try again</Button>
        <Button variant="outline" nativeButton={false} render={<Link href="/" />}>
          Back home
        </Button>
      </div>

      {/* Labelled and at full muted contrast: this is the string a user is
          asked to quote in a bug report, so it should not be the least legible
          thing on the page. */}
      {error.digest ? (
        <p className="font-mono text-xs text-muted-foreground mt-10 tabular-nums">
          Error ID: {error.digest}
        </p>
      ) : null}
    </main>
  );
}
