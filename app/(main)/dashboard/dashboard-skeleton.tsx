import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";

export function DashboardSkeleton() {
  return (
    <div className="space-y-10">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg bg-muted/40 px-5 py-5">
            <Skeleton className="h-3 w-16 rounded" />
            <Skeleton className="mt-3 h-8 w-20 rounded" />
          </div>
        ))}
      </div>
      <section className="space-y-5">
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-32 rounded" />
          <Skeleton className="h-7 w-36 rounded" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      </section>
    </div>
  );
}
