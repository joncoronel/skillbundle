import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { cn } from "@/lib/utils";
import { ownerHref } from "@/lib/skill-urls";
import { LinkPending } from "@/components/link-pending";
import { DataErrorBoundary } from "@/components/data-error-boundary";
import { SKILL_SYNC_TAG } from "@/lib/cache-tags";
import { rowPositionClassName } from "@/lib/listing-styles";

export const metadata: Metadata = {
  title: "Official skills | SkillBundle",
  description:
    "First-party skills curated by the makers — companies and orgs publishing skills for the technology they build.",
};

// Tagged "skill-sync" so the curated list busts in lockstep with the catalog
// instead of drifting up to a day behind it. Both writers of this data already
// ping that tag via /api/revalidate — convex/curatedRefresh.ts (weekly curated
// refresh) and convex/skills.ts (daily sync) — so this needs no new tag and no
// change to the allowlist in app/api/revalidate/route.ts. Without it, a newly
// curated publisher stays invisible here even though its skill pages already
// render. The cacheLife window is the fallback for a missed ping.
async function loadCuratedOwners() {
  "use cache";
  cacheLife("days");
  cacheTag(SKILL_SYNC_TAG);
  return fetchQuery(api.curated.listCuratedOwners, {});
}

export default async function OfficialPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-12 pb-20">
      <header>
        <h1 className="text-display">Official.</h1>
        <p className="mt-3 max-w-prose text-sm text-muted-foreground">
          Skills published by the companies and organizations that build the
          technology. Curated by{" "}
          <a
            href="https://skills.sh/official"
            target="_blank"
            rel="noopener noreferrer"
            className="underline transition-colors hover:text-foreground"
          >
            skills.sh
          </a>
          .
        </p>
      </header>

      <div className="mt-12">
        <DataErrorBoundary label="the curated publishers">
          <Suspense fallback={<OfficialPageSkeleton />}>
            <OfficialContent />
          </Suspense>
        </DataErrorBoundary>
      </div>
    </div>
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
      <div className="mb-6 flex items-center gap-3 px-4 text-sm text-muted-foreground tabular-nums">
        <span>
          {owners.length} publisher{owners.length === 1 ? "" : "s"}
        </span>
        <span aria-hidden="true">·</span>
        <span>
          {totalSkills} skill{totalSkills === 1 ? "" : "s"}
        </span>
      </div>

      <div className="grid">
        {owners.map((owner, i) => (
          <Link
            key={owner.owner}
            href={ownerHref(owner.owner)}
            className={cn(
              "relative block rounded-2xl border bg-card px-4 py-3 dark:border-border/50",
              "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:bg-surface-hover after:opacity-0 hover:after:opacity-100",
              rowPositionClassName(i, owners.length),
            )}
          >
            <div className="flex min-w-0 items-baseline gap-3">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-sm font-semibold">
                  {owner.owner}
                </span>
                <LinkPending />
              </span>
              <span className="ml-auto flex shrink-0 items-baseline gap-3 text-xs text-muted-foreground tabular-nums">
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
        ))}
      </div>
    </>
  );
}

function OfficialPageSkeleton() {
  return (
    <>
      <div className="mb-6 flex items-center gap-3 px-4 text-sm">
        <Skeleton className="h-4 w-20" />
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        <Skeleton className="h-4 w-24" />
      </div>

      <div className="grid">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "rounded-2xl border bg-card px-4 py-3 dark:border-border/50",
              rowPositionClassName(i, 8),
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
        ))}
      </div>
    </>
  );
}
