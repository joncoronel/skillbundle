"use client";

import { useEffect, useRef } from "react";
import { track } from "@/lib/analytics";

/**
 * Reports that an error boundary rendered. A rate signal, not error monitoring:
 * see the `error_boundary_shown` note in `lib/analytics.ts`.
 *
 * Sends the digest and the boundary name only, never `error.message`, which on
 * a client throw is arbitrary text that can carry a URL or an id.
 *
 * Takes the digest as a STRING so the effect's deps stay primitive. `catchError`
 * hands its fallback a `thrownValue` of unknown type, and normalising it with
 * `new Error(...)` at the call site would mint a fresh object every render and
 * re-fire the report in a loop.
 *
 * The ref dedupes re-renders of a mounted fallback. It deliberately does NOT
 * dedupe across `retry()`, which unmounts the fallback: each failed retry is a
 * separate failure and should count as one.
 */
export function useErrorReport(
  digest: string | undefined,
  boundary: string,
): void {
  const reported = useRef<string | null>(null);

  useEffect(() => {
    const key = digest ?? "no-digest";
    if (reported.current === key) return;
    reported.current = key;
    track("error_boundary_shown", { boundary, digest: key });
  }, [digest, boundary]);
}
