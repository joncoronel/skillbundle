import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";

export default function BundleLoading() {
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
