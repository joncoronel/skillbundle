import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { BundleCardSkeleton } from "@/components/bundle-card";
import { solidSurface } from "@/lib/cubby-ui/elevated";
import { cn } from "@/lib/utils";

export function DashboardSkeleton() {
  return (
    <div className="space-y-10">
      {/* Status panel. Sized to the all-clear reading rather than the
          has-changes one: nothing-changed is the common outcome, so a skeleton
          the height of a full change list would collapse on almost every
          load. */}
      <div
        className={cn(
          "flex items-center gap-3 rounded-2xl px-5 py-4 sm:px-6",
          solidSurface(3, 1),
        )}
      >
        <Skeleton className="size-5 shrink-0 rounded-full" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-44 rounded" />
          <Skeleton className="h-3 w-64 max-w-full rounded" />
        </div>
      </div>

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
