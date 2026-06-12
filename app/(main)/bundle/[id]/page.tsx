import type { Metadata } from "next";
import { fetchQuery, preloadQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { getAuth, getAuthToken } from "@/lib/auth";
import { BundleView } from "./bundle-view";

// Bundle name/description in the title and OG tags so shared links unfurl
// meaningfully in chat apps — sharing is the product's core loop. The route is
// dynamic anyway (auth cookies + share token), so this runs per request; the
// extra getByUrlId call alongside the page's preloadQuery is absorbed by
// Convex's query cache (identical args, same auth, milliseconds apart).
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ share?: string }>;
}): Promise<Metadata> {
  const [{ id }, { share }, token] = await Promise.all([
    params,
    searchParams,
    getAuthToken(),
  ]);
  // Deliberate conflation: transient Convex errors fall through to the same
  // generic-title + noindex branch as missing/private bundles. For metadata,
  // failing toward "say nothing" is the safe direction — the page itself
  // still loads (or errors) on its own path below.
  const bundle = await fetchQuery(
    api.bundles.getByUrlId,
    { urlId: id, shareToken: share },
    { token },
  ).catch(() => null);

  // Missing or private-without-access: keep the generic title and stay out
  // of search indexes.
  if (!bundle) {
    return { title: "Bundle", robots: { index: false } };
  }

  const description =
    bundle.description ||
    `A bundle of ${bundle.skills.length} AI coding assistant skill${bundle.skills.length === 1 ? "" : "s"}, curated by ${bundle.creatorName}.`;

  return {
    title: `${bundle.name} | SkillBundle`,
    description,
    openGraph: {
      title: bundle.name,
      description,
      type: "website",
    },
    // Private bundles reached via share token shouldn't be indexed.
    ...(bundle.isPublic ? {} : { robots: { index: false } }),
  };
}

// No page-level <Suspense> here: the whole page is async data loading, so the
// route's `loading.tsx` is the single loading boundary (shown while this awaits
// during navigation). A page-level Suspense with the same skeleton would be
// redundant with loading.tsx.
export default async function BundlePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ share?: string }>;
}) {
  // Read the route param, share token, and auth (cookies) in parallel, then
  // preload the bundle and plan with the user's token.
  const [{ id }, { share }, auth, token] = await Promise.all([
    params,
    searchParams,
    getAuth(),
    getAuthToken(),
  ]);
  const [preloadedBundle, preloadedPlan] = await Promise.all([
    preloadQuery(
      api.bundles.getByUrlId,
      { urlId: id, shareToken: share },
      { token },
    ),
    preloadQuery(api.plans.currentPlan, {}, { token }),
  ]);

  // Auth state from the actual session. We deliberately don't derive this
  // from `token !== undefined` because getAuthToken() returns undefined on
  // both "not signed in" AND ClerkOfflineError — using the session userId
  // means a signed-in user during a transient Clerk outage doesn't get
  // bounced to /sign-in when clicking action buttons.
  const isAuthenticated = auth.userId !== null;

  return (
    <BundleView
      preloadedBundle={preloadedBundle}
      preloadedPlan={preloadedPlan}
      urlId={id}
      shareToken={share}
      isAuthenticated={isAuthenticated}
    />
  );
}
