import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { fetchQuery } from "convex/nextjs";
import { cacheLife } from "next/cache";
import { api } from "@/convex/_generated/api";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { cn } from "@/lib/utils";
import { ownerHref } from "@/lib/skill-urls";

export const metadata: Metadata = {
  title: "Official skills | SkillStack",
  description:
    "First-party skills curated by the makers — companies and orgs publishing skills for the technology they build.",
};

async function loadCuratedOwners() {
  "use cache";
  cacheLife("days");
  return fetchQuery(api.curated.listCuratedOwners, {});
}

export default async function OfficialPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 pt-12 pb-20">
      <header>
        <h1 className="font-display text-[clamp(2.5rem,5vw,4rem)] font-semibold tracking-tight leading-hero text-balance">
          Official.
        </h1>
        <p className="mt-3 max-w-prose text-sm text-muted-foreground">
          Skills published by the companies and organizations that build the
          technology. Curated by{" "}
          <a
            href="https://skills.sh/official"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground transition-colors"
          >
            skills.sh
          </a>
          .
        </p>
      </header>

      <div className="mt-12">
        <Suspense fallback={<OfficialPageSkeleton />}>
          <OfficialContent />
        </Suspense>
      </div>
    </main>
  );
}

async function OfficialContent() {
  const owners = await loadCuratedOwners();

  if (owners.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Curated skills aren&apos;t available yet — check back after the next
        sync.
      </p>
    );
  }

  const totalSkills = owners.reduce((acc, o) => acc + o.skillCount, 0);

  return (
    <>
      <div className="flex items-center gap-3 text-sm font-mono tabular-nums text-muted-foreground mb-6 px-4">
        <span>
          {owners.length} publisher{owners.length === 1 ? "" : "s"}
        </span>
        <span aria-hidden="true">·</span>
        <span>
          {totalSkills} skill{totalSkills === 1 ? "" : "s"}
        </span>
      </div>

      <div className="grid">
        {owners.map((owner, i) => {
          const isFirst = i === 0;
          const isLast = i === owners.length - 1;
          const isSolo = owners.length === 1;
          return (
            <Link
              key={owner.owner}
              href={ownerHref(owner.owner)}
              className={cn(
                "block bg-card rounded-2xl border dark:border-border/50 py-3 px-4",
                "hover:bg-accent/50 duration-150 hover:duration-0 transition-colors",
                isSolo
                  ? undefined
                  : isFirst
                    ? "rounded-b-none"
                    : isLast
                      ? "rounded-t-none border-t-0"
                      : "rounded-none border-t-0",
              )}
            >
              <div className="flex items-baseline gap-3 min-w-0">
                <span className="text-sm font-semibold">{owner.owner}</span>
                <span className="ml-auto flex items-baseline gap-3 text-xs font-mono tabular-nums text-muted-foreground shrink-0">
                  <span>
                    {owner.repoCount} repo{owner.repoCount === 1 ? "" : "s"}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {owner.skillCount} skill
                    {owner.skillCount === 1 ? "" : "s"}
                  </span>
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}

function OfficialPageSkeleton() {
  return (
    <>
      <div className="flex items-center gap-3 text-sm mb-6 px-4">
        <Skeleton className="h-4 w-20" />
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        <Skeleton className="h-4 w-24" />
      </div>

      <div className="grid">
        {Array.from({ length: 8 }).map((_, i) => {
          const isFirst = i === 0;
          const isLast = i === 7;
          return (
            <div
              key={i}
              className={cn(
                "bg-card rounded-2xl border dark:border-border/50 py-3 px-4",
                isFirst
                  ? "rounded-b-none"
                  : isLast
                    ? "rounded-t-none border-t-0"
                    : "rounded-none border-t-0",
              )}
            >
              <div className="flex items-baseline gap-3">
                <Skeleton className="h-4 w-24" />
                <div className="ml-auto flex items-baseline gap-3">
                  <Skeleton className="h-3 w-14" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
