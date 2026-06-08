import { preloadQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { getAuth, getAuthToken } from "@/lib/auth";
import { BundleView } from "./bundle-view";

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
