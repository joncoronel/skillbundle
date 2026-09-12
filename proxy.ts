import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Inverted from public-list because the org matchers (`/:org`, `/:org/:repo`)
// match any single/double-segment path — including `/dashboard`, `/settings`,
// `/dev` — making them silently public. Next.js routing precedence resolves
// /dashboard to the right PAGE, but createRouteMatcher only does pattern
// matching, not routing precedence. Listing private routes explicitly avoids
// that pitfall.
const isPrivateRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/settings(.*)",
  "/dev(.*)",
]);

// Exact paths, NOT `/sign-in(.*)`, and that is the whole design of this list.
//
// `/sign-in/sso-callback` must NOT be here. It is the landing point of the
// OAuth round trip, and the session is established there — so a rule that
// bounces authenticated requests off it would fight Clerk's own callback
// handling on exactly the request that completes a social sign-in.
//
// Which means every new page under `/sign-in` has to opt in BY NAME. That is
// easy to forget: `/sign-in/reset` shipped without it and so let a signed-in
// user reach a password-reset form, where Clerk refused `signIn.create()` with
// "You're already signed in" and left them on a screen with nowhere to go. The
// redirect is the right layer for this — it happens before render, so there is
// no flash of a form the user was never allowed to use.
const isAuthRoute = createRouteMatcher([
  "/sign-in",
  "/sign-up",
  "/sign-in/reset",
]);

export default clerkMiddleware(async (auth, request) => {
  const { isAuthenticated } = await auth();

  // Redirect signed-in users away from auth pages
  if (isAuthRoute(request) && isAuthenticated) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Try Clerk's `auth.protect()` — if it works in this setup, it handles the
  // 307 redirect AND preserves the return URL via `redirect_url` automatically.
  // Reference: https://github.com/clerk/javascript/issues/8302 — in Next.js 16
  // the proxy runs in Node.js runtime, where NEXT_PUBLIC_CLERK_SIGN_IN_URL
  // isn't always populated; in that case the helper falls back to "" and the
  // redirect resolves to the current URL (no-op). The bug is reported in
  // pnpm-workspace + Turbo monorepos; a single-package repo may be unaffected.
  if (isPrivateRoute(request) && !isAuthenticated) {
    await auth.protect();
  }
});

// An ALLOWLIST, not "everything except static assets".
//
// Clerk's quickstart matcher matches every non-asset path, which is the right
// default when `auth()` might be called from anywhere. Here it can't be:
// server-side Clerk (`@clerk/nextjs/server`) is reachable from exactly two
// modules, `lib/auth.ts` and `app/(main)/settings/actions.ts`, and between them
// they only cover the paths below. Everything else reads auth on the CLIENT
// through ClerkProvider — see the comment in components/header-auth-client.tsx,
// which explains that this is deliberate so the catalog routes stay static.
//
// The broad matcher cost ~574k Node middleware invocations a day against ~56k
// actual renders (measured Sep 2026). The proxy runs BEFORE the CDN, so even a
// fully cached static page paid a `await auth()` JWT verification on every hit:
// the logs read `cache=HIT ... serverless-middleware`. Link prefetch is what
// made that expensive rather than merely wasteful — one skill page view fans
// out across its four tab routes and two breadcrumbs before the visitor clicks
// anything, so the multiplier was roughly 10x.
//
// A new route that calls `auth()`, `auth.protect()` or `currentUser()` on the
// server has to be added HERE as well. Forgetting throws at request time rather
// than failing the build: "auth() was called but Clerk can't detect usage of
// clerkMiddleware()". https://clerk.com/err/auth-middleware
//
// `/sign-in(.*)` and `/sign-up(.*)` are PREFIXES here, even though
// `isAuthRoute` above is a list of exact paths. Those two lists answer
// different questions: this one is "does the proxy run", `isAuthRoute` is "does
// it redirect". Keeping the prefix means `/sign-in/sso-callback` still gets the
// proxy, while `isAuthRoute` still refuses to bounce it — which is the
// behaviour the comment on `isAuthRoute` describes and relies on.
//
// Narrowing this to the exact paths would have been free volume (the callback
// sees a handful of requests a day) in exchange for changing what runs on the
// landing point of every OAuth round trip. Not a trade worth making.
export const config = {
  matcher: [
    "/dashboard(.*)",
    "/settings(.*)",
    "/dev(.*)",
    // `getAuthToken()` runs in the page itself, before any `preloadQuery`.
    "/bundle/(.*)",
    "/sign-in(.*)",
    "/sign-up(.*)",
    // No API route reads Clerk today — they gate on shared secrets — but these
    // are a few dozen requests a day and one that did would fail confusingly.
    "/(api|trpc)(.*)",
    // Clerk-specific frontend API routes (per Clerk v7 docs)
    "/__clerk/(.*)",
  ],
};
