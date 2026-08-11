import type { Metadata } from "next";
import { io } from "next/cache";
import { fetchQuery, preloadQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { getAuthToken } from "@/lib/auth";
import { BundleView } from "./bundle-view";

// Bundle name/description in the title and OG tags so shared links unfurl
// meaningfully in chat apps — sharing is the product's core loop. The route is
// dynamic anyway (auth cookies), so this runs per request; the
// extra getByUrlId call alongside the page's preloadQuery is absorbed by
// Convex's query cache (identical args, same auth, milliseconds apart).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  // Same reason as the page body below: this reads an auth cookie, so it is
  // per-request by nature, and declaring that up front keeps Convex's
  // `Math.random()` in ConvexHttpClient from being reported as a stray
  // unstable value. Metadata can't be wrapped in <Suspense>, so `io()` is the
  // only way to express it here.
  await io();

  const [{ id }, token] = await Promise.all([params, getAuthToken()]);
  // Deliberate conflation: transient Convex errors fall through to the same
  // generic-title + noindex branch as missing/private bundles. For metadata,
  // failing toward "say nothing" is the safe direction — the page itself
  // still loads (or errors) on its own path below.
  const bundle = await fetchQuery(
    api.bundles.getByUrlId,
    { urlId: id },
    { token },
  ).catch(() => null);

  // Missing, or closed and this isn't the owner: keep the generic title and
  // stay out of search indexes.
  if (!bundle) {
    return { title: "Bundle", robots: { index: false } };
  }

  const description =
    bundle.description ||
    `A bundle of ${bundle.skills.length} AI coding assistant skill${bundle.skills.length === 1 ? "" : "s"}, curated by ${bundle.creatorName}.`;

  // Version the OG image URL by updatedAt, in the PATH so each version is its
  // own cached route (rendered once, then served from cache). Social platforms
  // cache the unfurl image by URL for days; bumping the version on every edit
  // makes both them and our cache serve the fresh card.
  const version = bundle.updatedAt ?? bundle.createdAt;
  const ogImage = `/bundle/${id}/og/${version}`;

  return {
    title: `${bundle.name} | SkillBundle`,
    description,
    openGraph: {
      title: bundle.name,
      description,
      type: "website",
      images: [{ url: ogImage, width: 1200, height: 630, alt: bundle.name }],
    },
    // A closed bundle only resolves for its owner; never index it.
    ...(bundle.isPublic ? {} : { robots: { index: false } }),
  };
}

// No page-level <Suspense> here: the whole page is async data loading, so the
// route's `loading.tsx` is the single loading boundary (shown while this awaits
// during navigation). A page-level Suspense with the same skeleton would be
// redundant with loading.tsx.
export default async function BundlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Declare this render as request-time before touching Convex.
  //
  // Without it, Next aborts the prerender here for the wrong reason: Convex's
  // `preloadQuery` constructs a ConvexHttpClient, whose default logger calls
  // `Math.random()` (convex/src/browser/logging.ts), and Next reports
  // `blocking-prerender-random` pointing into node_modules. That insight is
  // noise — this route is genuinely per-request because it reads an auth
  // cookie — but it hides real unstable-value bugs behind a known-bad entry.
  //
  // `io()` rather than `connection()`: the docs say to prefer it and keep
  // `connection()` for when you need to wait for a real user request
  // (node_modules/next/dist/docs/.../io.md, "How `io()` differs from
  // `connection()`"). It has not replaced `connection()`; both still exist.
  //
  // Not verified: whether this call is what silences the insight. `io.md`'s
  // "When you don't need `io()`" says a request-time API is itself the
  // suspension point, and `getAuthToken()` reads a Clerk cookie before any
  // `preloadQuery` runs — so this may be redundant. Do NOT generalise it into
  // "wrap Convex calls in `io()`", which is the opposite of what the docs say.
  // To settle it: drop this line, restart `next dev` (a long-lived one throws
  // bogus instant-validation invariants — see TODO.md), and see if the insight
  // returns.
  //
  // The route still serves an instant shell: `loading.tsx` is its boundary, and
  // e2e/instant-navigation.spec.ts asserts the header chrome paints before the
  // bundle data arrives.
  await io();

  // Read the route param and the auth token in parallel, then preload with it.
  //
  // Both queries are preloaded together. The change list used to be fetched
  // client-side by BundleView (`useQuery`), which meant the register painted
  // every row as Steady with a "Checking N skills…" line *after* the page
  // content had already arrived — a second loading phase on a page that had
  // finished loading. Preloading it here removes that phase; `usePreloadedQuery`
  // keeps the subscription live afterwards, so edits still stream in.
  //
  // It cannot be `'use cache'` like the catalog loaders: `listChangesForBundle`
  // reads `getCurrentUser`, so its result is per-viewer and has no business in
  // a shared cache. Preloading with the token is the per-user equivalent.
  const [{ id }, token] = await Promise.all([params, getAuthToken()]);
  const [preloadedBundle, preloadedChanges] = await Promise.all([
    preloadQuery(api.bundles.getByUrlId, { urlId: id }, { token }),
    preloadQuery(
      api.skillVersions.listChangesForBundle,
      { urlId: id },
      { token },
    ),
  ]);

  // Deliberately NO region `DataErrorBoundary` here, for the same reason
  // app/(main)/page.tsx has none: the awaits above run in the page body, so a
  // `preloadQuery` rejection happens before this element tree exists and would
  // escape any boundary declared in it. One wrapped `BundleView` and looked
  // like insurance while catching nothing but client render errors.
  //
  // The fix is not to add a `<Suspense>` and move the awaits inside it — this
  // route's shell is `loading.tsx`, and adding an in-page boundary would give
  // it two loading surfaces, the exact "pick one, not both" failure documented
  // in docs/architecture.md §1. `app/(main)/error.tsx` covers this route: it
  // keeps the header and bundle bar and offers the same `retry()`.
  return (
    <BundleView
      preloadedBundle={preloadedBundle}
      preloadedChanges={preloadedChanges}
      urlId={id}
    />
  );
}
