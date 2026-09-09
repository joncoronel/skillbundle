"use client";

/**
 * Product analytics events, and the only place they are named.
 *
 * ── Why a wrapper instead of calling `track()` directly ───────────────────
 *
 * OpenPanel creates an event the first time it sees a name, so `"bundle_saved"`
 * and `"bundle_save"` become two events in the dashboard with no warning and no
 * way to merge them after the fact. A typo is not a bug you find, it is a
 * funnel that silently reads half as high as it should. The union type below
 * turns that into a compile error.
 *
 * ── What is safe to put in `properties` ───────────────────────────────────
 *
 * Nothing that identifies a person. No email, no user id, no bundle name, no
 * search query. The privacy policy says analytics are not tied to your account,
 * and that sentence is only true if this stays true. Counts, plan names, and
 * enum-ish strings are fine; free text the user typed is not.
 *
 * ── Behaviour outside production ──────────────────────────────────────────
 *
 * `OpenPanelComponent` is only mounted when `NODE_ENV === "production"`
 * (app/layout.tsx), so in dev `window.op` is undefined. The SDK calls it
 * optionally (`window.op?.(...)`), so every call here is a silent no-op in dev
 * rather than a crash. That means a miswired event will NOT show up as an error
 * locally — verify new events against the OpenPanel dashboard after deploying,
 * not against the console.
 */
export type AnalyticsEvent =
  /**
   * A new account was created and the session finalized. Top of the funnel.
   *
   * KNOWN GAP: email/password sign-ups only. OAuth (Google, GitHub) completes
   * inside Clerk's `<AuthenticateWithRedirectCallback>` on the sso-callback
   * route, which exposes no success hook for us to fire from, so those accounts
   * are not counted. Read this number as "password signups", not "signups", and
   * compare it against the real total in the Clerk dashboard before concluding
   * anything about conversion. Same caveat applies to `signin_completed`.
   */
  | "signup_completed"
  /** An existing user finished signing in. Same OAuth gap as above. */
  | "signin_completed"
  /** A bundle was created. The activation moment for this product. */
  | "bundle_created"
  /** The upgrade button was pressed, before Polar's hosted checkout loads. */
  | "checkout_started"
  /** A repo was submitted for technology matching (the paid discovery path). */
  | "repo_match_run"
  /** A skill was contributed to the public catalog. */
  | "skill_submitted"
  /**
   * An error boundary rendered instead of the content it was guarding.
   *
   * THIS IS NOT ERROR MONITORING, and should not be mistaken for it. It gives
   * you a count and a `digest` you can grep the Vercel logs for. It gives you
   * no stack trace, no grouping, no alerting, and no server-side or unhandled-
   * rejection coverage — `app/global-error.tsx` cannot report at all, because
   * it replaces the whole document and the OpenPanel script goes with it.
   *
   * What it is good for: noticing that the error rate moved. If it ever does,
   * the real tool for the job is Sentry or an equivalent.
   */
  | "error_boundary_shown";

type AnalyticsProperties = Record<string, string | number | boolean>;

/**
 * Calls the global queue directly rather than importing the SDK's own `track`.
 *
 * Not a preference: `@openpanel/nextjs` declares `track` in its type
 * definitions but does not export it. The package's only exports are the three
 * components and the `useOpenPanel()` hook, so importing it is a compile error
 * (TS2459), and the hook would force all five call sites to lift a hook out of
 * their event handlers to component scope for no gain. This is byte-for-byte
 * what the SDK's own `track` does — see `window.op?.("track", …)` in
 * `node_modules/@openpanel/nextjs/dist/index.js`.
 *
 * `window.op` is declared globally by `@openpanel/web` (as required, not
 * optional), so no augmentation is needed here — but the optional call `?.()`
 * is, because outside production the init snippet never runs and the property
 * really is undefined despite what the type says.
 *
 * If a future SDK version exports `track` properly, switch to it.
 */
export function track(
  event: AnalyticsEvent,
  properties?: AnalyticsProperties,
): void {
  window.op?.("track", event, properties);
}
