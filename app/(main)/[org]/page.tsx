import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { unstable_cache } from "next/cache";
import { fetchQuery } from "convex/nextjs";
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
import { LinkPending } from "@/components/link-pending";

type Params = Promise<{ org: string }>;

// Classic ISR: generate each org page on first request and cache it.
export const revalidate = 86400; // 1 day
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

// `unstable_cache` isolates `fetchQuery`'s no-store fetch (so the route can be
// statically generated) and caches per `org` (args are part of the key). It
// also dedupes the call between `generateMetadata` and the page body.
const loadOrg = unstable_cache(
  (org: string) => fetchQuery(api.skills.listRepoAggregatesByOrg, { org }),
  ["org-aggregates"],
  { revalidate: 86400 },
);

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { org } = await params;
  const { repos, totalSkillCount } = await loadOrg(org);

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

export default async function OrgPage({ params }: { params: Params }) {
  const { org } = await params;

  return (
    <div className="mx-auto max-w-6xl px-4 pt-12 pb-24">
      <Breadcrumb size="sm" className="mb-8">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink
              render={({ className }) => (
                <Link href="/" className={className}>
                  Home
                </Link>
              )}
            />
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{org}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <h1 className="font-display text-[clamp(2.25rem,5vw,3.5rem)] font-medium tracking-tight leading-hero text-balance mb-6">
        {org}
      </h1>

      <Suspense fallback={<OrgListSkeleton />}>
        <OrgListContent org={org} />
      </Suspense>
    </div>
  );
}

async function OrgListContent({ org }: { org: string }) {
  const { repos, totalSkillCount, totalInstalls } = await loadOrg(org);

  if (repos.length === 0) {
    notFound();
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 mb-12">
        <div className="flex items-center gap-3 text-sm font-mono tabular-nums text-muted-foreground">
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
            leftSection={
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

      <div className="flex items-center justify-between px-4 mb-2 font-mono text-eyebrow font-medium uppercase tracking-eyebrow text-muted-foreground">
        <span>Source</span>
        <span>Installs</span>
      </div>

      <div className="grid">
        {repos.map((repo, i) => {
          const isFirst = i === 0;
          const isLast = i === repos.length - 1;
          const isSolo = repos.length === 1;
          return (
            <div
              key={repo.source}
              className={cn(
                "bg-card rounded-2xl border dark:border-border/50 py-3",
                isSolo
                  ? undefined
                  : isFirst
                    ? "rounded-b-none"
                    : isLast
                      ? "rounded-t-none border-t-0"
                      : "rounded-none border-t-0",
              )}
            >
              <div className="flex items-center gap-3 px-4">
                <div className="flex flex-wrap items-baseline gap-x-2 min-w-0">
                  <Link
                    href={`/${repo.source}`}
                    className="text-sm font-semibold hover:underline inline-flex items-center gap-1.5"
                  >
                    <span>{repo.repo}</span>
                    <LinkPending />
                  </Link>
                  <span className="text-xs font-mono tabular-nums text-muted-foreground">
                    {repo.skillCount} skill{repo.skillCount === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="ml-auto shrink-0 text-xs font-mono tabular-nums text-muted-foreground">
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 mb-12">
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

      <div className="flex items-center justify-between px-4 mb-2 font-mono text-eyebrow font-medium uppercase tracking-eyebrow text-muted-foreground">
        <span>Source</span>
        <span>Installs</span>
      </div>

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
                <div className="flex items-baseline gap-x-2 min-w-0">
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
