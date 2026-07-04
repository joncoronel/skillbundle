"use client";

import { useEffect, useMemo, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useConvex } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import {
  SelectableSkillRow,
  type SkillData,
  type LeaderboardMetric,
} from "@/components/skill-card";
import type { SkillDetailHandle } from "@/components/skill-detail-sheet";
import { useHydrated } from "@/hooks/use-hydrated";
import { DotMatrixComet } from "@/components/ui/dot-matrix-comet";

type Page = FunctionReturnType<typeof api.skills.listPopularSkills>;

// ---------------------------------------------------------------------------
// Popular catalog list (paginated, infinite scroll)
//
// This is the entry-state catalog on the home page: the server-cached first
// page renders statically (SSR + prerender), then infinite scroll activates
// client-side. The old Popular/Trending/Hot tab block that used to live here
// was replaced by the zeitgeist rail (components/zeitgeist-rail.tsx) + the
// catalog section — see components/skill-explorer.tsx.
// ---------------------------------------------------------------------------

// `useInfiniteQuery`'s observer reads `Date.now()` during render, which can't be
// baked into a prerender. Render the server-cached first page statically for SSR
// and first paint (real content in the static shell), then activate infinite
// scroll once the client takes over.
export function PopularList({
  initialPage,
  sheetHandle,
}: {
  initialPage: Page;
  sheetHandle: SkillDetailHandle;
}) {
  // useHydrated: false during the prerender and hydration render, then true —
  // so the Date.now()-reading observer below only mounts on the client.
  const isClient = useHydrated();

  if (!isClient) {
    const skills = initialPage.page.map(rowToSkill);
    return skills.length === 0 ? (
      <EmptyState message="No skills available yet." />
    ) : (
      <SkillRowGrid skills={skills} sheetHandle={sheetHandle} />
    );
  }

  return (
    <PopularInfiniteList initialPage={initialPage} sheetHandle={sheetHandle} />
  );
}

function PopularInfiniteList({
  initialPage,
  sheetHandle,
}: {
  initialPage: Page;
  sheetHandle: SkillDetailHandle;
}) {
  const convex = useConvex();
  const sentinelRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const skills = useMemo(
    () => (data?.pages ?? []).flatMap((p) => p.page.map(rowToSkill)),
    [data?.pages],
  );

  if (skills.length === 0) {
    return <EmptyState message="No skills available yet." />;
  }

  return (
    <>
      <SkillRowGrid skills={skills} sheetHandle={sheetHandle} />
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      {isFetchingNextPage && (
        <div className="flex items-center justify-center gap-2 mt-4 text-muted-foreground">
          <DotMatrixComet size="xs" ariaLabel="Loading more skills" />
          <span className="text-xs">Loading more skills…</span>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared building blocks (also used by the zeitgeist rail + active results)
// ---------------------------------------------------------------------------

export function SkillRowGrid({
  skills,
  sheetHandle,
  metric,
}: {
  skills: SkillData[];
  sheetHandle: SkillDetailHandle;
  metric?: LeaderboardMetric;
}) {
  return (
    <div className="grid grid-cols-1">
      {skills.map((skill, i) => {
        const isFirst = i === 0;
        const isLast = i === skills.length - 1;
        const isSolo = skills.length === 1;
        return (
          <SelectableSkillRow
            key={`${skill.source}/${skill.skillId}`}
            skill={skill}
            sheetHandle={sheetHandle}
            metric={metric}
            className={
              isSolo
                ? undefined
                : isFirst
                  ? "rounded-b-none"
                  : isLast
                    ? "rounded-t-none border-t-0"
                    : "rounded-none border-t-0"
            }
          />
        );
      })}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border py-10 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
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
  curatedOwner?: string;
  worstAuditStatus?: string;
  worstAuditRiskLevel?: string;
  trendingRank?: number;
  trendingInstalls?: number;
  hotChange?: number;
  hotInstallsYesterday?: number;
  copyCount?: number;
}): SkillData {
  return {
    source: r.source,
    skillId: r.skillId,
    name: r.name,
    description: r.description,
    installs: r.installs,
    isDelisted: r.isDelisted,
    hasContentFetchError: r.hasContentFetchError,
    curatedOwner: r.curatedOwner,
    worstAuditStatus: r.worstAuditStatus,
    worstAuditRiskLevel: r.worstAuditRiskLevel,
    copyCount: r.copyCount,
    trendingRank: r.trendingRank,
    trendingInstalls: r.trendingInstalls,
    hotChange: r.hotChange,
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
