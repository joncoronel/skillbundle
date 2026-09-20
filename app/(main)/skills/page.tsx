import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/cubby-ui/breadcrumbs";
import { cn } from "@/lib/utils";
import { LISTING_TITLE_SCALE } from "@/lib/listing-styles";
import { DataErrorBoundary } from "@/components/data-error-boundary";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { JsonLd } from "@/components/json-ld";
import { breadcrumbLd, itemListLd } from "@/lib/structured-data";
import { SITE_URL } from "@/lib/site-url";
import { loadCategoryCounts } from "@/lib/category-counts";
import { CATEGORY_KEYS, CATEGORY_LABELS } from "@/convex/lib/categories";
import { categoryHref, CATEGORIES_PATH } from "@/lib/skill-urls";

/**
 * The category hub: one link to each of the 28 category pages.
 *
 * Its job is structural before it is editorial. The catalog had no tier
 * between the home page and ~16k skill pages, so link equity had nowhere to
 * flow and 13,556 URLs sat "Discovered - currently not indexed" (TODO.md,
 * "Search: the indexing gap"). This is that tier: linked from the footer and
 * from every category breadcrumb, linking down to 28 pages that each link to
 * 60 skills.
 *
 * Fully static. `loadCategoryCounts` is one cached facet query, so the whole
 * page prerenders and the counts refresh in the background once a day.
 */

const TITLE = "Browse agent skills by category | SkillBundle";
const DESCRIPTION =
  "Every category of agent skill for Claude Code, Cursor and Codex: frontend, testing, security, databases, docs and 23 more. Ranked by installs.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: CATEGORIES_PATH },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    url: CATEGORIES_PATH,
  },
};

export default function CategoriesPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-12 pb-24">
      <JsonLd
        data={breadcrumbLd([
          { name: "Home", path: "/" },
          { name: "Categories", path: CATEGORIES_PATH },
        ])}
      />

      <Breadcrumb size="sm" className="mb-8">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/" />}>Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Categories</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <h1 className={cn(LISTING_TITLE_SCALE, "mb-3 text-balance")}>
        Skills by category
      </h1>
      <p className="mb-10 max-w-[74ch] text-base leading-relaxed text-pretty text-muted-foreground">
        Every skill in the catalog is sorted into one or more of these
        categories, and each page lists the most installed skills in it.
      </p>

      {/* Suspense INSIDE the boundary, per components/data-error-boundary.tsx
          ("place it around an existing Suspense, not inside it"). Without one,
          a cold cache suspends past this point to the route level and the
          breadcrumb, h1 and blurb wait with the grid instead of streaming. */}
      <DataErrorBoundary label="the category list">
        <Suspense fallback={<CategoryGridSkeleton />}>
          <CategoryGrid />
        </Suspense>
      </DataErrorBoundary>
    </div>
  );
}

async function CategoryGrid() {
  const counts = await loadCategoryCounts();

  // Ordered by size rather than by the declaration order in categories.ts.
  // That file's order is editorial grouping (frontend, design, mobile, …),
  // which is a reasonable reading order but puts near-empty categories in the
  // first row. On a page whose job is to send readers somewhere, the biggest
  // buckets should be the ones they see first.
  const ordered = [...CATEGORY_KEYS].sort((a, b) => counts[b] - counts[a]);

  return (
    <>
      <JsonLd
        data={itemListLd(
          ordered.map((key) => ({
            name: CATEGORY_LABELS[key],
            url: `${SITE_URL}${categoryHref(key)}`,
          })),
          "Agent skill categories",
        )}
      />

      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {ordered.map((key) => (
          <li key={key}>
            {/* The app's surface idiom, not a hand-rolled border: a
                `bg-surface-N` paired with its matching
                `shadow-[var(--surface-shadow-N),var(--surface-rim-N)]`, which
                is how `RECORD_SURFACE` and the cubby-ui cards draw a raised
                panel (DESIGN.md §5). The rim IS the edge, so no `border` is
                needed and none is added — a border here would sit outside the
                rim and read as a double line in light mode.

                `rounded-xl` at `px-4 py-3`, one step down from the `rounded-2xl`
                the full-width record card uses: these tiles are a third of its
                width, and a 16px corner on a 360px card is the same optical
                weight as a 12px corner on a 120px one.

                `hover:bg-surface-hover` is the established hover fill (30 other
                call sites). `transition-colors` names its properties — never
                `transition-all`. `min-h-16` (64px) clears the 44px touch
                target on the shortest label with room to spare. */}
            <Link
              href={categoryHref(key)}
              className="flex min-h-16 items-center justify-between gap-3 rounded-xl bg-surface-3 px-4 py-3 shadow-[var(--surface-shadow-1),var(--surface-rim-1)] transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50"
            >
              <span className="text-sm font-medium text-balance text-foreground">
                {CATEGORY_LABELS[key]}
              </span>
              {/* Tabular so 28 counts of differing width set on one right
                  edge instead of ragging across the grid.

                  "skills" is visually hidden rather than dropped: without it
                  the link's accessible name was "Frontend 1,057", an unlabelled
                  number repeated across 28 tiles, and no column header or
                  intro sentence says what it counts. */}
              <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                {counts[key].toLocaleString("en-US")}
                <span className="sr-only"> skills</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The grid's shape: 28 tiles at the same height the resolved ones take. */
function CategoryGridSkeleton() {
  return (
    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: CATEGORY_KEYS.length }).map((_, i) => (
        <li key={i}>
          <div className="flex min-h-16 items-center justify-between gap-3 rounded-xl bg-surface-3 px-4 py-3 shadow-[var(--surface-shadow-1),var(--surface-rim-1)]">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-10 shrink-0" />
          </div>
        </li>
      ))}
    </ul>
  );
}
