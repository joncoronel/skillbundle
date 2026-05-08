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

const isAuthRoute = createRouteMatcher(["/sign-in", "/sign-up"]);

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

export const config = {
  matcher: [
    // Skip Next.js internals and all static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // API routes
    "/(api|trpc)(.*)",
    // Clerk-specific frontend API routes (per Clerk v7 docs)
    "/__clerk/(.*)",
  ],
};
