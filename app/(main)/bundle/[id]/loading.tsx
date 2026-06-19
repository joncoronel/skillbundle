import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";

export default function BundleLoading() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-12 pb-20">
      <div className="space-y-12">
        <header>
          {/* "by {creator}" meta line */}
          <Skeleton className="h-4 w-32 rounded" />
          {/* Bundle name (pixel display hero) */}
          <Skeleton className="mt-2 h-12 w-2/3 rounded md:h-14" />
          {/* Description */}
          <Skeleton className="mt-3 h-4 w-96 max-w-full rounded" />
          {/* Metadata row */}
          <Skeleton className="mt-4 h-4 w-72 max-w-full rounded" />
          {/* Action row (Fork + Star) */}
          <div className="mt-6 flex flex-wrap gap-2">
            <Skeleton className="h-9 w-24 rounded-lg sm:h-8" />
            <Skeleton className="h-9 w-20 rounded-lg sm:h-8" />
          </div>
        </header>

        <section>
          <div className="mb-5 flex items-center justify-between gap-3">
            {/* "Install" section header */}
            <Skeleton className="h-6 w-24 rounded" />
            {/* Copy all */}
            <Skeleton className="h-9 w-24 rounded-lg sm:h-8" />
          </div>
          <Skeleton className="h-24 w-full rounded-xl" />
        </section>

        <section>
          <div className="mb-5">
            {/* "Skills · N" section header */}
            <Skeleton className="h-6 w-28 rounded" />
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
