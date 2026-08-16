import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";

/**
 * Shell for `/bundle/[id]`. This route's whole body is request-time (it reads an
 * auth cookie), so this is what every visitor sees first — it has to be a
 * believable outline of the real page, not an approximation of an older one.
 *
 * It had drifted badly. It still drew the pre-register bundle page: a Fork/Star
 * action row that no longer exists (social features were removed), a tall
 * install block that is now a collapsed disclosure, and a three-column card grid
 * where the page now renders a register table — with Install above Skills, which
 * is also the wrong order now. Loading it looked like one page and then
 * resolving into a visibly different one, which reads as the skeleton being
 * replaced by a second, different skeleton.
 *
 * Geometry notes, so this survives the next redesign:
 *  - Type-scale wrappers (`text-4xl md:text-5xl` etc.) with `h-[1em]` bars
 *    inside, rather than hardcoded pixel heights, so the placeholder tracks the
 *    real element's line box at every breakpoint.
 *  - No action row. The real one is `empty:hidden` and renders nothing for
 *    non-owners, which is the common case for a shared link — drawing buttons
 *    there guaranteed a shift for exactly the visitor this route exists for.
 *  - No description bar. It's optional on the bundle, so reserving space for it
 *    shifts every bundle that doesn't have one.
 */
export default function BundleLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-12 pb-20">
      <div className="space-y-12">
        <header>
          {/* "by {creator}" */}
          <div className="text-sm">
            <Skeleton className="h-[1em] w-32 rounded" />
          </div>

          {/* Bundle name — mirrors the real h1's scale and leading. */}
          <div className="mt-2 font-display text-4xl leading-hero md:text-5xl">
            <Skeleton className="h-[1em] w-2/3 max-w-md rounded" />
          </div>

          {/* "Created x ago" */}
          <div className="mt-4 text-sm">
            <Skeleton className="h-[1em] w-40 rounded" />
          </div>
        </header>

        <section className="space-y-4">
          {/* SectionHeader: "Skills · N" on the left, Install disclosure right. */}
          <div className="flex items-center justify-between gap-3">
            <div className="text-xl">
              <Skeleton className="h-[1em] w-32 rounded" />
            </div>
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>

          {/* The register. A table, so the placeholder is a header strip plus
              evenly spaced rows rather than cards. Six rows is a middling
              bundle — enough to fill the fold without over-reserving for the
              small ones. */}
          <div className="rounded-2xl border dark:border-border/50">
            <div className="flex items-center gap-4 border-b px-4 py-2.5 dark:border-border/50">
              <Skeleton className="h-3 w-28 rounded" />
              <Skeleton className="h-3 w-20 rounded" />
              <Skeleton className="ml-auto h-3 w-16 rounded" />
            </div>
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-4 px-4 py-3 not-last:border-b dark:not-last:border-border/50"
              >
                <Skeleton className="size-1.75 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-40 max-w-full rounded" />
                  <Skeleton className="h-3 w-56 max-w-full rounded" />
                </div>
                <Skeleton className="ml-auto hidden h-3 w-16 shrink-0 rounded sm:block" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
