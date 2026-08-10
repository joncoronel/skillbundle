import type { Metadata } from "next";
import { io } from "next/cache";
import { fetchQuery, preloadQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { getAuthToken } from "@/lib/auth";
import { BundleView } from "./bundle-view";
import { DataErrorBoundary } from "@/components/data-error-boundary";

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
  // `io()` is 16.3's replacement for `connection()`; unlike Suspense it is the
  // sanctioned fix for *unstable values* (the error's own remedy list offers
  // only [dynamic]/[cache]/[client] — notably not [stream]).
  //
  // The route still serves an instant shell: `loading.tsx` is its boundary, and
  // e2e/instant-navigation.spec.ts asserts the header chrome paints before the
  // bundle data arrives.
  await io();

  // Read the route param and the auth token in parallel, then preload the
  // bundle with it.
  // The plan is no longer read here: closing a bundle used to be Pro-gated and
  // the card grid needed to know whether the viewer could quick-add. Neither is
  // true now, so the page preloads one query instead of two.
  const [{ id }, token] = await Promise.all([params, getAuthToken()]);
  const preloadedBundle = await preloadQuery(
    api.bundles.getByUrlId,
    { urlId: id },
    { token },
  );

  return (
    <DataErrorBoundary label="this bundle">
      <BundleView preloadedBundle={preloadedBundle} urlId={id} />
    </DataErrorBoundary>
  );
}
