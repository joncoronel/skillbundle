import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { BundleCardSkeleton } from "@/components/bundle-card";

export function DashboardSkeleton() {
  return (
    <div className="space-y-10">
      {/* Stats summary line (e.g. "3/3 bundles · 0 copies · 0 forks · Free plan") */}
      <Skeleton className="h-5 w-72 max-w-full rounded" />

      <section className="space-y-5">
        <div className="flex items-center justify-between">
          {/* "N BUNDLES" mono label */}
          <Skeleton className="h-4 w-24 rounded" />
          {/* Sort control */}
          <Skeleton className="h-7 w-36 rounded" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <BundleCardSkeleton key={i} hasActions />
          ))}
        </div>
      </section>
    </div>
  );
}
