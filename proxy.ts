import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in",
  "/sign-in/sso-callback",
  "/sign-up",
  "/sign-up/sso-callback",
  "/stack/(.*)",
  "/explore",
  "/compare",
  "/pricing",
  // Static routes above take precedence in Next.js routing, so
  // /explore, /dashboard, etc. resolve to their own pages — these
  // dynamic matchers only catch otherwise-unmatched segments.
  "/:org", // Org directory pages
  "/:org/:repo", // Repo skill directory pages
  "/:org/:repo/:skillId", // Skill detail pages
]);

const isAuthRoute = createRouteMatcher(["/sign-in", "/sign-up"]);

export default clerkMiddleware(async (auth, request) => {
  const { userId } = await auth();

  // Redirect signed-in users away from auth pages
  if (isAuthRoute(request) && userId) {
    return Response.redirect(new URL("/", request.url));
  }

  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
