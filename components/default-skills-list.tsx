"use client";

import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useConvex } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { useInfiniteScrollSentinel } from "@/hooks/use-infinite-scroll-sentinel";
import {
  LIST_ROW_ON_RAISED,
  rowPositionClassName,
  SelectableSkillRow,
  type SkillData,
  type LeaderboardMetric,
} from "@/components/skill-card";
import { useHydrated } from "@/hooks/use-hydrated";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type Page = FunctionReturnType<typeof api.skills.listPopularSkills>;

// ---------------------------------------------------------------------------
// Popular catalog list (paginated, infinite scroll)
//
// This is the entry-state catalog on the home page: the server-cached first
// page renders statically (SSR + prerender), then infinite scroll activates
// client-side. Trending/Hot live in their own sheet (leaderboard-sheet.tsx);
// the active search state swaps this list for ActiveCatalogResults — see
// components/skill-explorer.tsx.
// ---------------------------------------------------------------------------

// `useInfiniteQuery`'s observer reads `Date.now()` during render, which can't be
// baked into a prerender. Render the server-cached first page statically for SSR
// and first paint (real content in the static shell), then activate infinite
// scroll once the client takes over.
export function PopularList({ initialPage }: { initialPage: Page }) {
  // useHydrated: false during the prerender and hydration render, then true —
  // so the Date.now()-reading observer below only mounts on the client.
  const isClient = useHydrated();

  if (!isClient) {
    const skills = initialPage.page.map(rowToSkill);
    return skills.length === 0 ? (
      <EmptyState message="No skills available yet." />
    ) : (
      <SkillRowGrid skills={skills} />
    );
  }

  return <PopularInfiniteList initialPage={initialPage} />;
}

function PopularInfiniteList({ initialPage }: { initialPage: Page }) {
  const convex = useConvex();

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ["skills", "popular"] as const,
      queryFn: async ({ pageParam }) =>
        convex.query(api.skills.listPopularSkills, {
          paginationOpts: {
            numItems: 30,
            cursor: pageParam as string | null,
          },
        }),
      initialPageParam: null as string | null,
      initialData: {
        pages: [initialPage],
        pageParams: [null as string | null],
      },
      getNextPageParam: (last) =>
        last.isDone ? undefined : last.continueCursor,
      staleTime: Infinity,
      // The list unmounts whenever the home page flips to its active state
      // (search/filters); a nonzero gcTime keeps already-fetched pages so
      // clearing the search restores the user's scroll depth instead of
      // resetting to page one.
      gcTime: 5 * 60_000,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    });

  const sentinelRef = useInfiniteScrollSentinel({
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  });

  const skills = useMemo(
    () => (data?.pages ?? []).flatMap((p) => p.page.map(rowToSkill)),
    [data?.pages],
  );

  if (skills.length === 0) {
    return <EmptyState message="No skills available yet." />;
  }

  return (
    <>
      {/* `aria-busy` while a page is in flight. Announcing every appended page
          of homogeneous rows is noise, and `LoadingMoreFooter` is decorative
          because it unmounts between pages and so could never announce. */}
      <div aria-busy={isFetchingNextPage || undefined}>
        <SkillRowGrid skills={skills} />
        <div ref={sentinelRef} aria-hidden="true" className="h-px" />
        {isFetchingNextPage && <LoadingMoreFooter noun="skills" />}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared building blocks (also used by the leaderboard sheet + active results)
// ---------------------------------------------------------------------------

export function SkillRowGrid({
  skills,
  metric,
  ground = "page",
}: {
  skills: SkillData[];
  metric?: LeaderboardMetric;
  /** What the list is sitting on. `raised` steps the row fill down so the
   *  stack reads against a surface that is already lifted — the leaderboard
   *  sheet. Light-only; see LIST_ROW_ON_RAISED. */
  ground?: "page" | "raised";
}) {
  return (
    <div className="grid grid-cols-1">
      {skills.map((skill, i) => (
        <SelectableSkillRow
          key={`${skill.source}/${skill.skillId}`}
          skill={skill}
          metric={metric}
          className={cn(
            // These lists are unbounded (infinite scroll): content-visibility
            // skips layout/paint for off-screen rows. The intrinsic-size
            // `auto` keyword remembers each row's real height once rendered
            // — 76px is only the pre-render estimate for scrollbar math.
            "[contain-intrinsic-size:auto_76px] [content-visibility:auto]",
            ground === "raised" && LIST_ROW_ON_RAISED,
            rowPositionClassName(i, skills.length),
          )}
        />
      ))}
    </div>
  );
}

export function EmptyState({
  message,
  children,
}: {
  message: string;
  /** Optional extra content under the message (a hint line, an action). */
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border py-10 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      {children}
    </div>
  );
}

/** Infinite-scroll "loading more" footer, shared by the paginated lists. */
export function LoadingMoreFooter({ noun }: { noun: string }) {
  return (
    <div
      aria-hidden
      className="mt-4 flex items-center justify-center gap-2 text-muted-foreground"
    >
      <Spinner size="xs" />
      <span className="text-xs">Loading more {noun}…</span>
    </div>
  );
}

export function rowToSkill(r: {
  source: string;
  skillId: string;
  name: string;
  description?: string;
  installs: number;
  isDelisted?: boolean;
  hasContentFetchError?: boolean;
  isGitHubOnly?: boolean;
  curatedOwner?: string;
  worstAuditStatus?: string;
  worstAuditRiskLevel?: string;
  trendingRank?: number;
  trendingInstalls?: number;
  hotChange?: number;
  hotInstallsYesterday?: number;
  copyCount?: number;
}): SkillData {
  // The row IS structurally a SkillData — spread it through; only the derived
  // field below needs computing.
  return {
    ...r,
    // Current-hour install volume = this hour's installs, reconstructed from
    // the delta + same-hour-yesterday. Only set for Hot-rail rows; it's the
    // metric the Hot list is ranked by, shown there in place of lifetime
    // installs so the ordering is legible.
    hot1hInstalls:
      r.hotChange !== undefined
        ? Math.max(0, r.hotChange + (r.hotInstallsYesterday ?? 0))
        : undefined,
  };
}
