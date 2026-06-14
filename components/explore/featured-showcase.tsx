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
      ) : data!.length === 1 ? (
        // A single pick reads as a full-width spotlight row rather than a
        // lonely card stranded in a multi-column grid.
        <FeaturedSpotlight bundle={data![0]} />
      ) : (
        <div
          className={cn(
            "grid gap-3",
            data!.length === 2
              ? "grid-cols-1 sm:grid-cols-2"
              : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
          )}
        >
          {data!.map((bundle) => (
            <FeaturedCard key={bundle._id} bundle={bundle} />
          ))}
        </div>
      )}
    </section>
  );
}

// Single feature: name + description as one left-aligned unit, all meta grouped
// into a single right-aligned column. Stacks on mobile, splits on sm+.
function FeaturedSpotlight({ bundle }: { bundle: FeaturedBundle }) {
  return (
    <Link href={`/bundle/${bundle.urlId}`} className="block">
      <Card
        level={3}
        shadowLevel={3}
        className="gap-4 p-6 transition-[background-color,box-shadow] duration-100 hover:bg-surface-hover sm:flex-row sm:items-center sm:gap-8"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h3 className="text-lg font-semibold leading-snug">{bundle.name}</h3>
          {bundle.description ? (
            <p className="text-sm text-muted-foreground line-clamp-2 wrap-break-word">
              {bundle.description}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col gap-1 font-mono text-xs tabular-nums text-muted-foreground sm:items-end sm:text-right">
          <span className="text-foreground">
            {bundle.skillCount} skill{bundle.skillCount !== 1 ? "s" : ""}
          </span>
          <FeaturedStatLine bundle={bundle} />
        </div>
      </Card>
    </Link>
  );
}

// 2–3 features: vertical cards in a grid. Name + skills on top, description,
// stats pinned to the bottom so they align across the row.
function FeaturedCard({ bundle }: { bundle: FeaturedBundle }) {
  return (
    <Link href={`/bundle/${bundle.urlId}`} className="block h-full">
      <Card
        level={3}
        shadowLevel={3}
        className="h-full gap-3 p-5 transition-[background-color,box-shadow] duration-100 hover:bg-surface-hover"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold leading-snug">{bundle.name}</h3>
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            {bundle.skillCount} skill{bundle.skillCount !== 1 ? "s" : ""}
          </span>
        </div>
        {bundle.description ? (
          <p className="text-sm text-muted-foreground line-clamp-2 wrap-break-word">
            {bundle.description}
          </p>
        ) : null}
        <div className="mt-auto">
          <FeaturedStatLine bundle={bundle} />
        </div>
      </Card>
    </Link>
  );
}

// The dot-separated copies · forks · stars · time line, shared by both layouts.
function FeaturedStatLine({ bundle }: { bundle: FeaturedBundle }) {
  const { copyCount, forkCount, starCount } = bundle;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs tabular-nums text-muted-foreground">
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
      className="gap-4 p-6 sm:flex-row sm:items-center sm:gap-8"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton className="h-lh w-40 rounded" />
        <Skeleton className="h-lh w-3/4 rounded" />
      </div>
      <div className="flex shrink-0 flex-col gap-1 sm:items-end">
        <Skeleton className="h-lh w-14 rounded" />
        <Skeleton className="h-lh w-36 rounded" />
      </div>
    </Card>
  );
}
