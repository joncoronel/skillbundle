import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";

export function DashboardSkeleton() {
  return (
    <div className="space-y-10">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg bg-muted/40 px-5 py-5">
            {/* Bar heights match the line-heights of the real StatCell text
                exactly: text-xs is 16px (h-4); text-3xl with leading-none is
                1.875rem = 30px (h-[30px], no Tailwind step lands on 30). Third
                bar mirrors StatCell's optional `sub` line — the Bundles card
                always has one and grid stretching pulls the other two to
                match its height. If StatCell's text classes or padding
                change, update these heights to match. */}
            <Skeleton className="h-4 w-16 rounded" />
            <Skeleton className="mt-2 h-[30px] w-20 rounded" />
            <Skeleton className="mt-1.5 h-4 w-14 rounded" />
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
