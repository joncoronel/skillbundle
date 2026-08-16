import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { representativeGitHubSkill } from "@/lib/representative-params";
import { loadSourceSkills } from "@/lib/source-skills";
import { HugeiconsIcon } from "@hugeicons/react";
import { GithubIcon } from "@hugeicons/core-free-icons";
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
import { SourceSkillList } from "@/components/source-skill-list";
import { DataErrorBoundary } from "@/components/data-error-boundary";

type Params = Promise<{ org: string; repo: string }>;

// One representative repo is prerendered so Next can extract this route's App
// Shell; every other repo is served that shell instantly and upgraded in the
// background on its first visit (the default dynamicParams behaviour under
// Cache Components).
export async function generateStaticParams() {
  const { source } = await representativeGitHubSkill();
  const [org, repo] = source.split("/");
  return [{ org, repo }];
}

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { org, repo } = await params;
  const source = `${org}/${repo}`;
  // Guarded for the same reason as the org route: `generateMetadata` runs
  // outside every boundary and awaits the same `'use cache'` loader the body
  // does, so an unguarded throw takes the route down before DataErrorBoundary
  // can render its fallback. A transient failure falls into the not-found
  // branch, the safe direction for metadata.
  const { skills } = (await loadSourceSkills(source).catch(() => null)) ?? {
    skills: [],
  };

  if (skills.length === 0) {
    return { title: "Repository not found | SkillBundle" };
  }

  const title = `${source} — skills | SkillBundle`;
  const description = `${skills.length} AI coding skill${
    skills.length === 1 ? "" : "s"
  } published by ${source}.`;

  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
  };
}

// `params` is passed into the boundaries rather than awaited here. See the
// matching comment in app/(main)/[org]/page.tsx — awaiting above the Suspense
// empties this route's shared App Shell and makes every client navigation into
// it blocking, while direct page loads still look fine.
export default function RepoPage({ params }: { params: Params }) {
  return (
    // `<main>`, not a div: this is the page's content landmark, and the skip
    // link in app/(main)/layout.tsx targets the wrapper just outside it.
    <div className="mx-auto max-w-6xl px-4 pt-12 pb-24">
      <Suspense fallback={<RepoHeaderSkeleton />}>
        <RepoHeader params={params} />
      </Suspense>

      <DataErrorBoundary label="this repository's skills">
        <Suspense fallback={<RepoListSkeleton />}>
          <RepoListContent params={params} />
        </Suspense>
      </DataErrorBoundary>
    </div>
  );
}

async function RepoHeader({ params }: { params: Params }) {
  const { org, repo } = await params;

  return (
    <>
      <Breadcrumb size="sm" className="mb-8">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/" />}>Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href={`/${org}`} />}>
              {org}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{repo}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <h1
        className={cn(LISTING_TITLE_SCALE, "mb-6 font-medium tracking-tight")}
      >
        <span className="text-muted-foreground/70">{org}/</span>
        <wbr />
        <span>{repo}</span>
      </h1>
    </>
  );
}

function RepoHeaderSkeleton() {
  return (
    <>
      {/* Real breadcrumb primitives, so the shell's separator matches the
          chevron the resolved header renders instead of swapping a "/" for it
          on every client navigation. "Home" is static, so it is genuine shell
          content; only the URL-dependent crumbs are Skeletons. */}
      <Breadcrumb size="sm" className="mb-8">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/" />}>Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <Skeleton className="h-4 w-20" />
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <Skeleton className="h-4 w-24" />
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className={cn("mb-6", LISTING_TITLE_SCALE)}>
        <Skeleton className="h-[1em] w-80 max-w-full" />
      </div>
    </>
  );
}

async function RepoListContent({ params }: { params: Params }) {
  const { org, repo } = await params;
  const source = `${org}/${repo}`;
  const { skills, totalInstalls } = await loadSourceSkills(source);

  if (skills.length === 0) {
    notFound();
  }

  return (
    <>
      <div className="mb-12 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-3 text-sm text-muted-foreground tabular-nums">
          <span>
            {skills.length} skill{skills.length === 1 ? "" : "s"}
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
                href={`https://github.com/${source}`}
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

      <SourceSkillList skills={skills} />
    </>
  );
}

function RepoListSkeleton() {
  return (
    <>
      <div className="mb-12 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-3 text-sm">
          <Skeleton className="h-4 w-20" />
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="ml-auto">
          <Skeleton className="h-9 w-32 rounded-lg sm:h-8" />
        </div>
      </div>

      {/* The selection row SourceSkillList renders above the column headers
          ("N skills from this source" + Add all / Remove all). Omitting it left
          ~44px unreserved, so the headers and every placeholder row below them
          jumped down the moment the list resolved. That shift used to hide on
          the ISR-miss path; deleting this route's loading.tsx made this
          fallback the only loading surface, which put it on the common one. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Skeleton className="h-4 w-48 max-w-[60%]" />
        <Skeleton className="h-9 w-32 rounded-lg sm:h-8" />
      </div>

      <div className="mb-2 flex items-center justify-between px-4 text-xs font-medium text-muted-foreground">
        <span>Skill</span>
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
                <Skeleton className="h-4 w-40" />
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
