import { Suspense } from "react";
import { verifyAdmin } from "@/lib/auth";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { DevDashboardContent } from "./dev-dashboard-content";

export default function DevDashboardPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-12 pb-20">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-medium tracking-tight">
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
  await verifyAdmin();
  return <DevDashboardContent />;
}

// Mirrors DevDashboardContent's real layout: 7 stat cells (matching
// StatsCards' xl:grid-cols-7), the error table, then the auth panel. Keep the
// counts in step when either side changes — a fallback that doesn't match reads
// to the user as a second, different skeleton rather than as the page arriving.
function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-96 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  );
}
