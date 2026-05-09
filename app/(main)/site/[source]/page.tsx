import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { fetchQuery } from "convex/nextjs";
import { cacheLife } from "next/cache";
import { HugeiconsIcon } from "@hugeicons/react";
import { GlobalSearchIcon } from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import {
  deriveSkillStatus,
  SkillStatusBadge,
} from "@/components/skill-status-badge";
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

type Params = Promise<{ source: string }>;

async function loadSource(source: string) {
  "use cache";
  cacheLife("days");
  const skills = await fetchQuery(api.skills.listBySource, { source });
  const visible = skills
    .filter((s) => !s.isDelisted)
    .sort((a, b) => b.installs - a.installs);
  const totalInstalls = visible.reduce((sum, s) => sum + s.installs, 0);
  return { skills: visible, totalInstalls };
}

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { source } = await params;
  const { skills } = await loadSource(source);

  if (skills.length === 0) {
    return { title: "Source not found | SkillStack" };
  }

  const title = `${source} — ${skills.length} skill${
    skills.length === 1 ? "" : "s"
  } | SkillStack`;
  const description = `${skills.length} AI coding skill${
    skills.length === 1 ? "" : "s"
  } published by ${source}.`;

  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
  };
}

export default async function WellKnownSourcePage({
  params,
}: {
  params: Params;
}) {
  const { source } = await params;

  return (
    <div className="mx-auto max-w-5xl px-4 pt-12 pb-24">
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
            <BreadcrumbPage>{source}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <h1 className="font-display text-[clamp(2.25rem,5vw,3.5rem)] font-semibold tracking-tight leading-hero text-balance mb-6">
        {source}
      </h1>

      <Suspense fallback={<SourceListSkeleton />}>
        <SourceListContent source={source} />
      </Suspense>
    </div>
  );
}

async function SourceListContent({ source }: { source: string }) {
  const { skills, totalInstalls } = await loadSource(source);

  if (skills.length === 0) {
    notFound();
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 mb-12">
        <div className="flex items-center gap-3 text-sm font-mono tabular-nums text-muted-foreground">
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
                href={`https://${source}`}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
            leftSection={
              <HugeiconsIcon
                icon={GlobalSearchIcon}
                strokeWidth={2}
                className="size-3.5"
              />
            }
          >
            Visit {source}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 mb-2 font-mono text-eyebrow font-medium uppercase tracking-eyebrow text-muted-foreground">
        <span>Skill</span>
        <span>Installs</span>
      </div>

      <div className="grid">
        {skills.map((skill, i) => {
          const isFirst = i === 0;
          const isLast = i === skills.length - 1;
          const isSolo = skills.length === 1;
          return (
            <div
              key={`${skill.source}/${skill.skillId}`}
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
                <Link
                  href={`/site/${skill.source}/${skill.skillId}`}
                  className="text-sm font-semibold hover:underline min-w-0 truncate"
                  prefetch={false}
                >
                  {skill.name}
                </Link>
                <div className="ml-auto shrink-0 flex items-center gap-1.5">
                  <SkillStatusBadge
                    status={deriveSkillStatus({
                      isDelisted: skill.isDelisted,
                      hasContentFetchError: skill.hasContentFetchError,
                    })}
                  />
                  <span className="text-xs font-mono tabular-nums text-muted-foreground">
                    {formatInstalls(skill.installs)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function SourceListSkeleton() {
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 mb-12">
        <div className="flex items-center gap-3 text-sm">
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
        <span>Skill</span>
        <span>Installs</span>
      </div>

      <div className="grid">
        {Array.from({ length: 4 }).map((_, i) => {
          const isFirst = i === 0;
          const isLast = i === 3;
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
