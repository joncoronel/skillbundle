"use client";

import { useEffect, useRef } from "react";
import { track } from "@/lib/analytics";

/**
 * Reports that an error boundary rendered, once per distinct error.
 *
 * Read the `error_boundary_shown` note in `lib/analytics.ts` before relying on
 * this: it is a rate signal, not error monitoring. No stack trace leaves the
 * browser.
 *
 * ── What is sent, and what is not ─────────────────────────────────────────
 *
 * `digest` and `boundary` only. NOT `error.message`: for a Server Component
 * failure Next replaces the message with a generic string anyway, but for a
 * client-side throw it is arbitrary text that can carry a URL, an id, or
 * whatever a third-party library decided to interpolate. That is exactly the
 * kind of value the privacy rule in `lib/analytics.ts` exists to keep out of
 * the analytics stream. `digest` is a hash Next generates specifically to be
 * the safe, quotable handle for the real error in the server logs.
 *
 * ── Why it takes a digest string, not the error ──────────────────────────
 *
 * So the effect's dependencies are primitives. `catchError` hands its fallback
 * a `thrownValue` of unknown type, and the natural-looking
 * `error instanceof Error ? error : new Error(...)` at the call site would mint
 * a fresh object on every render, changing the dependency identity every time
 * and re-firing the report in a loop. A string cannot do that.
 *
 * ── What the ref does and does not cover ─────────────────────────────────
 *
 * It dedupes re-renders of a MOUNTED fallback, which is what stops one error
 * reporting twice because React re-rendered the tree.
 *
 * It does NOT dedupe across `retry()`. That calls `setState` to clear the error
 * (`next/dist/client/components/catch-error.js`), which unmounts the fallback,
 * so the next throw mounts a fresh one with a fresh ref and reports again. That
 * is the intended reading: each failed retry is a real, separate failure, and
 * the count should say so. Do not "fix" it with a module-scope set without
 * deciding you want retries to be invisible.
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
