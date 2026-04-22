import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";

export function DashboardSkeleton() {
  return (
    <div className="space-y-10">
      <div className="grid grid-cols-2 divide-x divide-y border-y md:grid-cols-4 md:divide-y-0">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="px-5 py-5">
            <Skeleton className="h-3 w-16 rounded" />
            <Skeleton className="mt-3 h-8 w-20 rounded" />
          </div>
        ))}
      </div>
      <section className="space-y-5">
        <div className="flex items-center justify-between border-b pb-3">
          <Skeleton className="h-3 w-24 rounded" />
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
