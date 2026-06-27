"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useConvex } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useQueryState } from "nuqs";
import { api } from "@/convex/_generated/api";
import {
  SelectableSkillRow,
  type SkillData,
  type LeaderboardMetric,
} from "@/components/skill-card";
import type { SkillDetailHandle } from "@/components/skill-detail-sheet";
import { useHydrated } from "@/hooks/use-hydrated";
import { DotMatrixComet } from "@/components/ui/dot-matrix-comet";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/cubby-ui/tabs";
import {
  leaderboardTabParser,
  type LeaderboardTabValue,
} from "@/lib/search-params";

type Page = FunctionReturnType<typeof api.skills.listPopularSkills>;
type TrendingPage = FunctionReturnType<typeof api.leaderboards.listTrending>;
type HotData = FunctionReturnType<typeof api.leaderboards.listHot>;

interface DefaultSkillsListProps {
  /** First page of popular skills, server-fetched + cached. */
  initialPage: Page;
  /** Server-fetched + cached top-N trending skills. */
  initialTrending: TrendingPage;
  /** Server-fetched + cached top-N hot skills. */
  initialHot: HotData;
  sheetHandle: SkillDetailHandle;
}

type LeaderboardTab = LeaderboardTabValue;

/**
 * Tabbed leaderboard shown on the home page when no search is active.
 * All three tabs are server-prefetched + cached (`'use cache'`) and
 * seeded as initialData here, so tab switches render instantly with no
 * client-side fetch on first visit.
 */
export function DefaultSkillsList({
  initialPage,
  initialTrending,
  initialHot,
  sheetHandle,
}: DefaultSkillsListProps) {
  // URL-backed so the active leaderboard is shareable and survives back/
  // forward navigation. "popular" is the default and stays unrepresented in
  // the URL — only "trending" and "hot" emit `?tab=...`.
  const [tab, setTab] = useQueryState("tab", leaderboardTabParser);
  const handleTabChange = useCallback(
    (v: string) => setTab(v as LeaderboardTab),
    [setTab],
  );

  return (
    <DefaultSkillsListView
      tab={tab}
      onTabChange={handleTabChange}
      initialPage={initialPage}
      initialTrending={initialTrending}
      initialHot={initialHot}
      sheetHandle={sheetHandle}
    />
  );
}

/**
 * Presentational leaderboard with the active tab controlled via props — no
 * URL state. Rendered by `DefaultSkillsList` (nuqs-backed) and by the home
 * page's Suspense fallback, which must not touch useSearchParams so the
 * default state can statically prerender.
 */
export function DefaultSkillsListView({
  tab,
  onTabChange,
  initialPage,
  initialTrending,
  initialHot,
  sheetHandle,
}: DefaultSkillsListProps & {
  tab: LeaderboardTabValue;
  onTabChange: (value: string) => void;
}) {
  return (
    <Tabs
      value={tab}
      onValueChange={onTabChange}
      className="mt-4"
    >
      <div className="mb-4 flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h2
            id="leaderboard-heading"
            className="font-display text-lg font-medium tracking-tight"
          >
            {tab === "popular" && "Popular skills"}
            {tab === "trending" && "Trending today"}
            {tab === "hot" && "Hot right now"}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {tab === "popular" && "Sorted by all-time installs from "}
            {tab === "trending" && "Most installed in the last 24 hours on "}
            {tab === "hot" && "Most installed in the last hour on "}
            <a
              href="https://skills.sh"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground transition-colors"
            >
              skills.sh
            </a>
          </p>
        </div>

        <TabsList
          variant="capsule"
          size="small"
          aria-labelledby="leaderboard-heading"
        >
          <TabsTrigger value="popular">Popular</TabsTrigger>
          <TabsTrigger value="trending">Trending</TabsTrigger>
          <TabsTrigger value="hot">Hot</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="popular" disableAnimation>
        <PopularList initialPage={initialPage} sheetHandle={sheetHandle} />
      </TabsContent>
      <TabsContent value="trending" disableAnimation>
        <TrendingList
          initialData={initialTrending}
          sheetHandle={sheetHandle}
        />
      </TabsContent>
      <TabsContent value="hot" disableAnimation>
        <HotList initialData={initialHot} sheetHandle={sheetHandle} />
      </TabsContent>
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// Tab: Popular (paginated, infinite scroll)
// ---------------------------------------------------------------------------

// `useInfiniteQuery`'s observer reads `Date.now()` during render, which can't be
// baked into a prerender. Render the server-cached first page statically for SSR
// and first paint (real content in the static shell), then activate infinite
// scroll once the client takes over.
function PopularList({
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
      gcTime: 0,
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
// Tab: Trending (single page — leaderboard is N=200 max)
// ---------------------------------------------------------------------------

function TrendingList({
  initialData,
  sheetHandle,
}: {
  initialData: TrendingPage;
  sheetHandle: SkillDetailHandle;
}) {
  // Rendered straight from the server-cached snapshot — no live Convex
  // subscription. The cache is refreshed on-demand by the trending cron (see
  // app/api/revalidate/route.ts), so this stays current without a
  // stale-then-live swap on load.
  const skills = useMemo(
    () => (initialData?.page ?? []).map(rowToSkill),
    [initialData],
  );
  if (skills.length === 0) {
    return <EmptyState message="No trending data yet — check back after the next sync." />;
  }
  return (
    <SkillRowGrid skills={skills} sheetHandle={sheetHandle} metric="trending" />
  );
}

// ---------------------------------------------------------------------------
// Tab: Hot (single page — small list)
// ---------------------------------------------------------------------------

function HotList({
  initialData,
  sheetHandle,
}: {
  initialData: HotData;
  sheetHandle: SkillDetailHandle;
}) {
  // Rendered straight from the server-cached snapshot — no live Convex
  // subscription. The cache is refreshed on-demand by the 30-min hot cron (see
  // app/api/revalidate/route.ts), so this stays current without the
  // empty-then-populated flash on load.
  const skills = useMemo(() => (initialData ?? []).map(rowToSkill), [initialData]);
  if (skills.length === 0) {
    return (
      <EmptyState message="No hot skills right now — check back after the next sync." />
    );
  }
  return (
    <SkillRowGrid skills={skills} sheetHandle={sheetHandle} metric="hot" />
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function SkillRowGrid({
  skills,
  sheetHandle,
  metric,
}: {
  skills: SkillData[];
  sheetHandle: SkillDetailHandle;
  metric?: LeaderboardMetric;
}) {
  return (
    <div className="grid">
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

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border py-10 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function rowToSkill(r: {
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
