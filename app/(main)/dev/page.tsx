import { Suspense } from "react";
import { verifySession } from "@/lib/auth";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { DevDashboardContent } from "./dev-dashboard-content";

export default function DevDashboardPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-12 pb-20">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Skill Sync Monitor
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Monitor sync pipeline health, view errors, and trigger actions.
        </p>
      </div>

      <Suspense fallback={<DashboardSkeleton />}>
        <DevLoader />
      </Suspense>
    </main>
  );
}

async function DevLoader() {
  await verifySession();
  return <DevDashboardContent />;
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}
