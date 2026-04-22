import { Suspense } from "react";
import { preloadQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { getAuthToken } from "@/lib/auth";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { BundleView } from "./bundle-view";

export default function BundlePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ share?: string }>;
}) {
  return (
    <Suspense fallback={<BundleViewSkeleton />}>
      <BundleLoader params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function BundleLoader({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ share?: string }>;
}) {
  // Note: this Promise.all works because params, searchParams, and getAuthToken()
  // all access dynamic data (route params, search params, cookies) which "unlocks"
  // Math.random() for the preloadQuery calls below. If you ever add another
  // preloadQuery to this top group, it will fail with cacheComponents enabled.
  const [{ id }, { share }, token] = await Promise.all([
    params,
    searchParams,
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

  return (
    <BundleView
      preloadedBundle={preloadedBundle}
      preloadedPlan={preloadedPlan}
      urlId={id}
      shareToken={share}
    />
  );
}

function BundleViewSkeleton() {
  return (
    <main className="mx-auto max-w-5xl px-4 pt-12 pb-20">
      <div className="space-y-12">
        <div>
          <Skeleton className="h-3 w-36 rounded" />
          <Skeleton className="mt-3 h-12 w-2/3 rounded md:h-14" />
          <Skeleton className="mt-4 h-3 w-80 rounded" />
        </div>

        <section>
          <div className="mb-5">
            <Skeleton className="h-7 w-48 rounded" />
          </div>
          <Skeleton className="h-28 w-full rounded-lg" />
        </section>

        <section>
          <div className="mb-5">
            <Skeleton className="h-7 w-44 rounded" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-2xl" />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
