"use client";

import { RouteErrorBody } from "@/components/route-error-body";

/**
 * Segment boundary for the sign-in and sign-up flows.
 *
 * `error.js` wraps only its own segment and children, so `(main)/error.tsx`
 * does not cover this group — without this file a throw during a Clerk render
 * or an SSO callback escaped all the way to `app/global-error.tsx`, which
 * renders its own document with no stylesheet, no header and no route back
 * into the app. That is the wrong surface for the one flow a user cannot skip.
 *
 * `retry()` rather than `reset()`, same reasoning as the `(main)` boundary.
 */
export default function AuthError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    // The landmark is supplied here, unlike `(main)/error.tsx`, because the two
    // groups own it at different levels: `(main)/layout.tsx` wraps its children
    // in one, while `(auth)`'s comes from `AuthFrame` — which this replaces.
    // Without it an auth error has a header and no main region at all.
    <main className="mx-auto max-w-2xl px-4">
      <RouteErrorBody
        error={error}
        retry={retry}
        description="Sign-in didn't load. It's usually temporary. Try again, or go back home."
      />
    </main>
  );
}
