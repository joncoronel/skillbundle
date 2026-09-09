"use client";

/**
 * Product analytics events, and the only place they are named.
 *
 * OpenPanel creates an event the first time it sees a name, so a typo makes a
 * second event in the dashboard with no way to merge the two afterwards. The
 * union below turns that into a compile error.
 *
 * `properties` must carry nothing that identifies a person: no email, user id,
 * bundle name, or search query. Counts, plan names and enum-ish strings only.
 * The privacy policy's "not tied to your account" depends on it.
 *
 * `OpenPanelComponent` mounts only in production (app/layout.tsx), so `window.op`
 * is undefined in dev and every call here is a silent no-op. A miswired event
 * will not surface locally; check the OpenPanel dashboard after deploying.
 */
export type AnalyticsEvent =
  /**
   * A new account was created and the session finalized.
   *
   * KNOWN GAP: password sign-ups only. OAuth completes inside Clerk's
   * `<AuthenticateWithRedirectCallback>`, which exposes no success hook, so
   * those are uncounted. Read it as "password signups" and cross-check the real
   * total in the Clerk dashboard. Same caveat on `signin_completed`.
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
   * A password reset finished and the session was established. A flat zero
   * after launch means the entry point is not being found, not that nobody
   * forgets their password.
   */
  | "password_reset_completed"
  /**
   * An error boundary rendered instead of the content it was guarding.
   *
   * NOT error monitoring: a count and a `digest` to grep the Vercel logs for,
   * with no stack trace, grouping, or alerting. `app/global-error.tsx` cannot
   * report at all, since it replaces the document and the OpenPanel script with
   * it. Good for noticing the error rate moved; Sentry is the real tool.
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
