"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { StarIcon } from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import { Card } from "@/components/ui/cubby-ui/card";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { cn, timeAgo } from "@/lib/utils";

const FEATURED_LIMIT = 3;

type FeaturedBundle = {
  _id: string;
  name: string;
  urlId: string;
  description?: string;
  skillCount: number;
  createdAt: number;
  copyCount?: number;
  forkCount?: number;
  starCount?: number;
};

// Columns track the actual count so the curated row always fills — a single
// feature spans full width (and, via the container query in the card, lays
// out horizontally as a spotlight) instead of stranding empty columns.
function gridCols(count: number) {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-1 sm:grid-cols-2";
  return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
}

export function FeaturedShowcase() {
  const { data, isPending } = useQuery({
    ...convexQuery(api.bundles.listFeatured, { limit: FEATURED_LIMIT }),
    gcTime: 5 * 60_000,
  });

  if (!isPending && (!data || data.length === 0)) return null;

  return (
    <section>
      <div className="mb-5">
        <h2 className="font-display text-4xl font-medium tracking-tight leading-tight text-balance">
          Featured.
        </h2>
      </div>

      {isPending ? (
        <FeaturedSpotlightSkeleton />
      ) : (
        <div className={cn("grid gap-3", gridCols(data!.length))}>
          {data!.map((bundle) => (
            <FeaturedBundleCard key={bundle._id} bundle={bundle} />
          ))}
        </div>
      )}
    </section>
  );
}

function FeaturedBundleCard({ bundle }: { bundle: FeaturedBundle }) {
  return (
    // Each card owns a container so width, not viewport, drives the layout:
    // full-width (solo feature) goes horizontal; narrow (2–3 up) stays stacked.
    <div className="@container h-full">
      <Link href={`/bundle/${bundle.urlId}`} className="block h-full">
        <Card
          level={3}
          shadowLevel={3}
          className="h-full gap-4 p-5 transition-[background-color,box-shadow] duration-100 hover:bg-surface-hover @3xl:flex-row @3xl:items-center @3xl:gap-8"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-semibold leading-snug">
                {bundle.name}
              </h3>
              <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                {bundle.skillCount} skill{bundle.skillCount !== 1 ? "s" : ""}
              </span>
            </div>
            {bundle.description ? (
              <p className="text-sm text-muted-foreground line-clamp-2 wrap-break-word">
                {bundle.description}
              </p>
            ) : null}
          </div>
          <FeaturedStats bundle={bundle} />
        </Card>
      </Link>
    </div>
  );
}

function FeaturedStats({ bundle }: { bundle: FeaturedBundle }) {
  const { copyCount, forkCount, starCount } = bundle;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs tabular-nums text-muted-foreground @3xl:justify-end">
      {copyCount !== undefined ? (
        <span>
          {copyCount} {copyCount === 1 ? "copy" : "copies"}
        </span>
      ) : null}
      {forkCount !== undefined && copyCount !== undefined ? (
        <span aria-hidden>&middot;</span>
      ) : null}
      {forkCount !== undefined ? (
        <span>
          {forkCount} {forkCount === 1 ? "fork" : "forks"}
        </span>
      ) : null}
      {starCount !== undefined &&
      (copyCount !== undefined || forkCount !== undefined) ? (
        <span aria-hidden>&middot;</span>
      ) : null}
      {starCount !== undefined ? (
        <span className="inline-flex items-center gap-1">
          <HugeiconsIcon
            icon={StarIcon}
            aria-hidden
            className="size-3 fill-current"
          />
          {starCount}
        </span>
      ) : null}
      <span aria-hidden>&middot;</span>
      <span>{timeAgo(bundle.createdAt)}</span>
    </div>
  );
}

function FeaturedSpotlightSkeleton() {
  return (
    <Card
      level={3}
      shadowLevel={3}
      className="gap-4 p-5 @3xl:flex-row @3xl:items-center @3xl:gap-8"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <Skeleton className="h-lh w-40 rounded" />
          <Skeleton className="h-lh w-14 shrink-0 rounded" />
        </div>
        <Skeleton className="h-lh w-3/4 rounded" />
      </div>
      <Skeleton className="h-lh w-36 shrink-0 rounded" />
    </Card>
  );
}
