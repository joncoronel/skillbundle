import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import { representativeGitHubSkill } from "@/lib/representative-params";
import { HugeiconsIcon } from "@hugeicons/react";
import { GithubIcon } from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/cubby-ui/button";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/cubby-ui/breadcrumbs";
import { cn, formatInstalls } from "@/lib/utils";
// The canonical row-corner helper and title scale. Re-implementing either
// inline is how the skeletons and their content branches drifted apart: the
// content branch handled the single-row case, its own skeleton did not. Both
// come from lib/ because this is a Server Component — the client module that
// re-exports them cannot be called from here.
import {
  LISTING_TITLE_SCALE,
  rowPositionClassName,
} from "@/lib/listing-styles";
import { LinkPending } from "@/components/link-pending";
import { DataErrorBoundary } from "@/components/data-error-boundary";
import { SKILL_SYNC_TAG } from "@/lib/cache-tags";

type Params = Promise<{ org: string }>;

// One representative org is prerendered so Next can extract this route's App
// Shell; every other org is served that shell instantly and upgraded in the
// background on its first visit (the default dynamicParams behaviour under
// Cache Components).
export async function generateStaticParams() {
  const { source } = await representativeGitHubSkill();
  return [{ org: source.split("/")[0] }];
}

// `'use cache'` isolates `fetchQuery`'s no-store fetch behind a cache boundary
// and keys the result by `org`, so the route prerenders and the
// `generateMetadata` pass + page body share one entry. Tagged "skill-sync" so it
// busts in lockstep with the skill pages whenever the catalog changes — the
// daily syncSkills ping and addSkillManually both hit this tag. Without it a
// newly-added org would 404 here for up to a day even though its skill pages
// already render (e.g. a manual add of the first skill in a new org).
async function loadOrg(org: string) {
  "use cache";
  cacheLife("days");
  cacheTag(SKILL_SYNC_TAG);
  return fetchQuery(api.skills.listRepoAggregatesByOrg, { org });
}

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { org } = await params;
  // Guarded so a Convex outage degrades to the region fallback instead of
  // taking the whole route down. `generateMetadata` runs outside every
  // boundary, and it awaits the same `'use cache'` loader the body does — so an
  // unguarded throw here rejects before `DataErrorBoundary` can render, making
  // the graceful degradation it was added for unreachable on this route.
  // Same conflation as the bundle route: a transient failure falls into the
  // not-found branch, which is the safe direction for metadata.
  const org_ = await loadOrg(org).catch(() => null);
  const { repos, totalSkillCount } = org_ ?? { repos: [], totalSkillCount: 0 };

  if (repos.length === 0) {
    return { title: "Organization not found | SkillBundle" };
  }

  const title = `${org} — ${repos.length} repo${
    repos.length === 1 ? "" : "s"
  } | SkillBundle`;
  const description = `${totalSkillCount} AI coding skill${
    totalSkillCount === 1 ? "" : "s"
  } across ${repos.length} repositor${
    repos.length === 1 ? "y" : "ies"
  } published by ${org}.`;

  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
  };
}

// The `params` promise is passed into the Suspense boundaries rather than
// awaited here, and that is load-bearing: under Partial Prefetching, Next
// builds ONE App Shell per route and reuses it for every link to that route, so
// the shell is rendered without URL data. Awaiting `params` at the top of the
// page would put every element below it — including the list skeleton — behind
// that unknown value, leaving the shared shell empty and making every client
// navigation into this route blocking.
//
// Direct page loads look fine either way (the URL is known), which is exactly
// why this regressed silently. The e2e guard in e2e/instant-navigation.spec.ts
// asserts the client-navigation case specifically.
export default function OrgPage({ params }: { params: Params }) {
  return (
    // `<main>`, not a div: this is the page's content landmark, and the skip
    // link in app/(main)/layout.tsx targets the wrapper just outside it.
    <div className="mx-auto max-w-6xl px-4 pt-12 pb-24">
      <Suspense fallback={<OrgHeaderSkeleton />}>
        <OrgHeader params={params} />
      </Suspense>

      <DataErrorBoundary label="this organization's repositories">
        <Suspense fallback={<OrgListSkeleton />}>
          <OrgListContent params={params} />
        </Suspense>
      </DataErrorBoundary>
    </div>
  );
}

// Breadcrumb tail and title are the org name itself — URL data, so they can
// never be part of the shared shell. They get their own boundary so the list
// below isn't held back waiting on them.
async function OrgHeader({ params }: { params: Params }) {
  const { org } = await params;

  return (
    <>
      <Breadcrumb size="sm" className="mb-8">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/" />}>Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{org}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <h1
        className={cn(LISTING_TITLE_SCALE, "mb-6 font-medium tracking-tight")}
      >
        {org}
      </h1>
    </>
  );
}

function OrgHeaderSkeleton() {
  return (
    <>
      {/* Built from the real breadcrumb primitives, not hand-drawn bars. This
          is the shared App Shell, so it is the first paint of every client
          navigation into this route — a hand-rolled "/" separator meant the
          shell painted `▭ / ▭` and then swapped to the chevron
          `BreadcrumbSeparator` actually renders. "Home" is a static literal, so
          it is real shell content rather than a placeholder; only the
          URL-dependent crumb is a Skeleton. */}
      <Breadcrumb size="sm" className="mb-8">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/" />}>Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <Skeleton className="h-4 w-28" />
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      {/* Same font-size/leading as the real h1 so the swap doesn't shift the
          list below it. */}
      <div className={cn("mb-6", LISTING_TITLE_SCALE)}>
        <Skeleton className="h-[1em] w-64 max-w-full" />
      </div>
    </>
  );
}

async function OrgListContent({ params }: { params: Params }) {
  const { org } = await params;
  const { repos, totalSkillCount, totalInstalls } = await loadOrg(org);

  if (repos.length === 0) {
    notFound();
  }

  return (
    <>
      <div className="mb-12 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-3 text-sm text-muted-foreground tabular-nums">
          <span>
            {repos.length} repositor{repos.length === 1 ? "y" : "ies"}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {totalSkillCount} skill{totalSkillCount === 1 ? "" : "s"}
          </span>
          <span aria-hidden="true">·</span>
          <span>{formatInstalls(totalInstalls)} installs</span>
        </div>
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <a
                href={`https://github.com/${org}`}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
            leadingIcon={
              <HugeiconsIcon
                icon={GithubIcon}
                strokeWidth={2}
                className="size-3.5"
              />
            }
          >
            View on GitHub
          </Button>
        </div>
      </div>

      <div className="mb-2 flex items-center justify-between px-4 text-xs font-medium text-muted-foreground">
        <span>Source</span>
        <span>Installs</span>
      </div>

      <div className="grid">
        {repos.map((repo, i) => {
          return (
            <div
              key={repo.source}
              className={cn(
                "rounded-2xl border bg-card py-3 dark:border-border/50",
                rowPositionClassName(i, repos.length),
              )}
            >
              <div className="flex items-center gap-3 px-4">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <Link
                    href={`/${repo.source}`}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
                  >
                    <span>{repo.repo}</span>
                    <LinkPending />
                  </Link>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {repo.skillCount} skill{repo.skillCount === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatInstalls(repo.totalInstalls)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function OrgListSkeleton() {
  return (
    <>
      <div className="mb-12 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-3 text-sm">
          <Skeleton className="h-4 w-28" />
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <Skeleton className="h-4 w-20" />
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="ml-auto">
          <Skeleton className="h-8 w-32 rounded-lg" />
        </div>
      </div>

      <div className="mb-2 flex items-center justify-between px-4 text-xs font-medium text-muted-foreground">
        <span>Source</span>
        <span>Installs</span>
      </div>

      <div className="grid">
        {Array.from({ length: 6 }).map((_, i) => {
          return (
            <div
              key={i}
              className={cn(
                "rounded-2xl border bg-card py-3 dark:border-border/50",
                rowPositionClassName(i, 6),
              )}
            >
              <div className="flex items-center gap-3 px-4">
                <div className="flex min-w-0 items-baseline gap-x-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-12" />
                </div>
                <div className="ml-auto shrink-0">
                  <Skeleton className="h-3 w-12" />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
