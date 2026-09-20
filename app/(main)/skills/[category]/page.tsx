import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
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
import {
  LISTING_TITLE_SCALE,
  rowPositionClassName,
} from "@/lib/listing-styles";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { CatalogSkillList } from "@/components/catalog-skill-list";
import { DataErrorBoundary } from "@/components/data-error-boundary";
import { JsonLd } from "@/components/json-ld";
import { breadcrumbLd, itemListLd } from "@/lib/structured-data";
import { SITE_URL } from "@/lib/site-url";
import { loadCategorySkills } from "@/lib/category-skills";
import {
  CATEGORY_KEYS,
  CATEGORY_LABELS,
  categoryKeyFromSlug,
  type CategoryKey,
} from "@/convex/lib/categories";
// Server Component only — the ~11 KB of definitions must never be passed into
// a client island. That file's header says "server-only" but does not enforce it.
import { CATEGORY_DEFINITIONS } from "@/convex/lib/categoryDefinitions";
import {
  categoryFilterHref,
  categoryHref,
  categorySlug,
  CATEGORIES_PATH,
  skillHref,
} from "@/lib/skill-urls";
import { truncateWords } from "@/lib/seo";
import { NOT_FOUND_ROBOTS } from "@/lib/soft-404";

type Params = Promise<{ category: string }>;

/**
 * One landing page per category.
 *
 * Why this route exists at all is in TODO.md, "Search: the indexing gap". The
 * short version: every skill page already links to its categories, and until
 * this shipped those links went to `/?cat=<key>` — the home page with a
 * client-side filter, which canonicalises to `/`. So roughly 16k internal
 * links pointed at one page, the catalog had almost no link graph of its own
 * (a skill page had 23 internal links, two of them to other catalog pages),
 * and nothing on the site targeted "<topic> skills for Claude Code", which is
 * the shape of query this product should win.
 *
 * ── A closed param set ────────────────────────────────────────────────────
 *
 * Unlike every other catalog route, the param set here is CLOSED: 28 keys in
 * `convex/lib/categories.ts`, and a key is only added by a code change that
 * also re-tags the catalog. So `generateStaticParams` returns all 28 and every
 * one prerenders.
 *
 * Two things that does NOT buy, both of which were assumed once and are wrong:
 *
 *   - It does not exempt the route from passing `params` into `<Suspense>`.
 *     See the note on the page component.
 *   - It does not let the route reject unknown slugs with a real 404.
 *     `dynamicParams = false` is unavailable under Cache Components (the
 *     documented replacement is `notFound()` when the param does not resolve —
 *     migrating-to-cache-components.md, "`dynamicParams` is not supported"),
 *     and that replacement answers 200 with a `noindex`. See the check in
 *     `generateMetadata`.
 */

export function generateStaticParams() {
  return CATEGORY_KEYS.map((key) => ({ category: categorySlug(key) }));
}

/**
 * The page's descriptive paragraph, and the lead of its meta description.
 *
 * Reused from what the TAGGER reads rather than written separately, so the page
 * cannot describe a category differently from how skills are assigned to it.
 * 28 hand-written blurbs would drift the first time a `doesNotCount` line was
 * sharpened, and nothing would catch it.
 */
function categoryBlurb(key: CategoryKey): string {
  return CATEGORY_DEFINITIONS[key].counts;
}

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { category: slug } = await params;
  const category = categoryKeyFromSlug(slug);
  // Metadata rather than `notFound()` here, matching the catalog routes: the
  // page below does call `notFound()`, but it renders inside the committed
  // response, so the status is 200 and the meta tag is what keeps the URL out
  // of the index. `NOT_FOUND_ROBOTS` adds the `nofollow` that Next's own late
  // injection leaves off. See lib/soft-404.ts.
  //
  // Verified against a production build: `/skills/nonsense` answers 200 with
  // the not-found body and `noindex`. Low-stakes here — the sitemap lists only
  // the 28 real slugs and nothing links to any other — but a route that is
  // inconsistent with the other four is a route someone has to re-derive.
  if (!category) {
    return {
      title: "Category not found | SkillBundle",
      robots: NOT_FOUND_ROBOTS,
    };
  }

  const label = CATEGORY_LABELS[category];
  // Guarded like the other catalog routes: `generateMetadata` resolves outside
  // every boundary, so an unguarded Typesense failure here rejects before
  // `DataErrorBoundary` can render and takes the whole route down. Falling back
  // to a countless title keeps the page up.
  const found = (await loadCategorySkills(category).catch(() => null))?.found;

  const title = `${label} skills for Claude Code and Cursor | SkillBundle`;
  const description = truncateWords(
    `${found ? `${found.toLocaleString("en-US")} agent skills` : "Agent skills"} for ${label}, ranked by installs. ${categoryBlurb(category)}`,
    160,
  );

  return {
    title,
    description,
    alternates: { canonical: categoryHref(category) },
    openGraph: {
      title,
      description,
      type: "website",
      url: categoryHref(category),
    },
  };
}

/**
 * The category behind a URL slug, or a 404.
 *
 * Both render paths need it and both must agree: two copies of the not-found
 * branch can drift into a resolved header sitting above a 404 body.
 * `generateMetadata` keeps its own nullable lookup, because it must return
 * metadata rather than throw.
 */
async function resolveCategory(params: Params): Promise<CategoryKey> {
  const { category: slug } = await params;
  const category = categoryKeyFromSlug(slug);
  if (!category) notFound();
  return category;
}

// Synchronous, with the `params` promise passed DOWN into the boundaries —
// the same rule docs/architecture.md imposes on `/[org]`, `/[org]/[repo]` and
// `/site/[source]`, and for the same reason.
//
// This route did `await params` here at first, on the reasoning that a closed
// param set means every page is prerendered and there is no shared App Shell
// to empty. That reasoning is wrong, and Next's instant validation says so in
// the dev overlay: Partial Prefetching builds ONE App Shell per ROUTE and
// reuses it for every `<Link>` into it, whether or not each param is also
// prerendered separately. So an await up here put the h1, the blurb and both
// skeletons behind an unknown value, and every client navigation from the hub
// into a category blocked.
//
// The e2e guard added with this route did not catch it, which is worth
// recording: it asserted the shell on a DIRECT LOAD, and a direct load has the
// URL, so it looks correct either way. That is the exact asymmetry AGENTS.md
// warns about. The guard is now a client navigation, hub -> category.
export default function CategoryPage({ params }: { params: Params }) {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-12 pb-24">
      <Suspense fallback={<CategoryHeaderSkeleton />}>
        <CategoryHeader params={params} />
      </Suspense>

      <DataErrorBoundary label="this category's skills">
        <Suspense fallback={<CategoryListSkeleton />}>
          <CategoryList params={params} />
        </Suspense>
      </DataErrorBoundary>
    </div>
  );
}

async function CategoryHeader({ params }: { params: Params }) {
  const category = await resolveCategory(params);
  const label = CATEGORY_LABELS[category];

  return (
    <>
      <JsonLd
        data={breadcrumbLd([
          { name: "Home", path: "/" },
          { name: "Categories", path: CATEGORIES_PATH },
          { name: label, path: categoryHref(category) },
        ])}
      />

      <Breadcrumb size="sm" className="mb-8">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/" />}>Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href={CATEGORIES_PATH} />}>
              Categories
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{label}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <h1 className={cn(LISTING_TITLE_SCALE, "mb-3 text-balance")}>
        {label} skills
      </h1>

      {/* `text-pretty` rather than `text-balance`: balance is for headings of a
          few words, and on a 74ch paragraph it evens the last two lines at the
          cost of ragging the rest. Pretty only pulls orphans back. */}
      <p className="mb-10 max-w-[74ch] text-base leading-relaxed text-pretty text-muted-foreground">
        {categoryBlurb(category)}
      </p>
    </>
  );
}

/**
 * The header's shape, for the shared App Shell.
 *
 * Two crumbs of this breadcrumb are REAL, not placeholders: "Home" and
 * "Categories" are fixed for every page in this route, so only the third is a
 * Skeleton. Built from the same breadcrumb primitives as the resolved header
 * so the separator is the same chevron — the org route records a bug where a
 * hand-drawn "/" in the shell swapped to a chevron on every navigation.
 *
 * The blurb placeholder is THREE lines, measured over all 28
 * `CATEGORY_DEFINITIONS[*].counts`: min 138 chars, median 181, max 255. At
 * `max-w-[74ch]` that is ~74 chars a line, so only 2 of 28 fit in two lines,
 * 20 need three and 6 need four. Three is the median and shifts 6 categories
 * by one line; two would have shifted 26. An earlier comment here claimed
 * "two is the mode" without measuring, and had it backwards.
 */
function CategoryHeaderSkeleton() {
  return (
    <>
      <Breadcrumb size="sm" className="mb-8">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/" />}>Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href={CATEGORIES_PATH} />}>
              Categories
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <Skeleton className="h-4 w-32" />
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Same font-size/leading as the real h1, so the swap doesn't shift
          anything below it. */}
      <div className={cn("mb-3", LISTING_TITLE_SCALE)}>
        <Skeleton className="h-[1em] w-72 max-w-full" />
      </div>

      <div className="mb-10 max-w-[74ch] space-y-2 text-base leading-relaxed">
        <Skeleton className="h-[1em] w-full" />
        <Skeleton className="h-[1em] w-full" />
        <Skeleton className="h-[1em] w-3/5" />
      </div>
    </>
  );
}

/**
 * The list's shape. What this contributes to the shell is the meta row's
 * height and the "Skill / Installs" column headers, which are real text —
 * the same thing the source listing pages put in theirs.
 */
function CategoryListSkeleton() {
  return (
    <>
      <div className="mb-12 flex items-center gap-3 text-sm">
        <Skeleton className="h-4 w-20" />
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        <Skeleton className="h-4 w-32" />
      </div>

      {/* The selection row CatalogSkillList renders above the column headers
          ("N skills on this page" + Add all). Omitting it dropped the headers
          and the whole list by its height on every navigation. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-9 w-28 rounded-lg sm:h-8" />
      </div>

      <div className="mb-2 flex items-center justify-between px-4 text-xs font-medium text-muted-foreground">
        <span>Skill</span>
        <span>Installs</span>
      </div>

      {/* Six placeholder rows, matching RepoListSkeleton. Without them the
          shell ended at the column headers and 60 resolved rows pushed the
          footer down by thousands of pixels. The sibling routes already
          reserved this height; the rename did not carry it across. */}
      <div className="grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "rounded-2xl border bg-card py-3 dark:border-border/50",
              rowPositionClassName(i, 6),
            )}
          >
            <div className="flex items-center gap-3 px-4">
              <Skeleton className="h-4 w-40" />
              <div className="ml-auto shrink-0">
                <Skeleton className="h-3 w-12" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

async function CategoryList({ params }: { params: Params }) {
  const category = await resolveCategory(params);
  const label = CATEGORY_LABELS[category];
  const { skills, found } = await loadCategorySkills(category);

  // A category with no skills is a real state — a new key tagged by a model
  // that has not yet found a match for it — and it is NOT a 404: the page is
  // still the right answer to "frontend skills", it just has nothing to list
  // yet. 404ing would also break the hub page's link to it.
  if (skills.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No skills are tagged {label} yet.{" "}
        <Link
          href={CATEGORIES_PATH}
          className="text-foreground underline underline-offset-4 transition-colors hover:text-primary"
        >
          Browse the other categories
        </Link>
        .
      </p>
    );
  }

  return (
    <>
      <JsonLd
        data={itemListLd(
          skills.map((s) => ({
            name: s.name,
            url: `${SITE_URL}${skillHref(s.source, s.skillId)}`,
          })),
          `${label} skills`,
        )}
      />

      {/* Same meta row as the source pages, so the three listing types read as
          one family. `tabular-nums` so the count does not shift against the
          categories either side of it.

          It states the CATEGORY's size and the list's ordering, and no second
          number, because the list header immediately below already prints how
          many rows are on the page. The first draft had three counts stacked
          within 80px — "410 skills · 1.6M installs across the top 60", then
          "60 skills in Code Review & Refactoring", then "Showing the 60 most
          installed" — which reads as a contradiction before it reads as a
          breakdown. The install subtotal went with it: a sum over 60 of 410
          rows is not a number anyone can use, and it had already needed a
          conditional label to stop being a lie. */}
      <div className="mb-12 flex items-center gap-3 text-sm text-muted-foreground">
        <span className="tabular-nums">
          {found.toLocaleString("en-US")} skill{found === 1 ? "" : "s"}
        </span>
        {found > skills.length && (
          <>
            <span aria-hidden="true">·</span>
            <span>Top {skills.length} by installs</span>
          </>
        )}
      </div>

      <CatalogSkillList
        skills={skills}
        // "60 skills on this page", against the "410 skills" above it. Naming
        // the page rather than the category is what keeps the two readable as
        // different facts rather than as disagreeing ones.
        scopeLabel="on this page"
        // Rows here come from many different repos, so the source is the only
        // thing distinguishing two skills that share a slug.
        showSource
      />

      {/* The way out of the top 60, and the only count left after the meta row
          was trimmed. A link, not a paginated page 2: see CATEGORY_PAGE_SIZE. */}
      {found > skills.length && (
        <p className="mt-8 text-sm text-muted-foreground">
          <Link
            href={categoryFilterHref(category)}
            className="text-foreground underline underline-offset-4 transition-colors hover:text-primary"
          >
            Browse all {found.toLocaleString("en-US")} {label} skills with
            filters
          </Link>
        </p>
      )}
    </>
  );
}
