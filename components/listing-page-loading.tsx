import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { cn } from "@/lib/utils";

// Shared route-level fallback for the org / repo / source listing pages. Shown
// by their `loading.tsx` while a not-yet-generated page is rendered on-demand;
// once ISR caches the page, repeat visits serve the finished HTML.
export function ListingPageLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 pt-12 pb-24">
      {/* breadcrumb */}
      <Skeleton className="mb-8 h-4 w-48 max-w-full" />

      {/* title */}
      <Skeleton className="mb-6 h-12 w-1/2 max-w-md" />

      {/* meta row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 mb-12">
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="ml-auto h-8 w-32 rounded-lg" />
      </div>

      {/* column headers */}
      <div className="flex items-center justify-between px-4 mb-2">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-3 w-12" />
      </div>

      {/* rows */}
      <div className="grid">
        {Array.from({ length: 6 }).map((_, i) => {
          const isFirst = i === 0;
          const isLast = i === 5;
          return (
            <div
              key={i}
              className={cn(
                "bg-card rounded-2xl border dark:border-border/50 py-3",
                isFirst
                  ? "rounded-b-none"
                  : isLast
                    ? "rounded-t-none border-t-0"
                    : "rounded-none border-t-0",
              )}
            >
              <div className="flex items-center gap-3 px-4">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="ml-auto h-3 w-12" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
