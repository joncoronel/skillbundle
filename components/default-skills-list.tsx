"use client";

import { useEffect, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useConvex } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { SelectableSkillRow, type SkillData } from "@/components/skill-card";
import type { SkillDetailHandle } from "@/components/skill-detail-sheet";
import { DotMatrixComet } from "@/components/ui/dot-matrix-comet";

type Page = FunctionReturnType<typeof api.skills.listPopularSkills>;

interface DefaultSkillsListProps {
  /** First page fetched on the server and passed in as initialData. */
  initialPage: Page;
  sheetHandle: SkillDetailHandle;
}

/**
 * Default "browse" list shown on the home page's text tab when the search
 * input is empty. The first page is fetched on the server and seeded via
 * useInfiniteQuery's initialData so there's no loading skeleton on first
 * render. Subsequent pages load as the user scrolls near the bottom.
 *
 * We use TanStack Query's useInfiniteQuery (not Convex's usePaginatedQuery)
 * because only the former supports seeding with server-fetched initial data.
 * We lose live reactivity on the popular list, which is fine — installs
 * update via a daily sync, not per interaction.
 *
 * Page-boundary consistency caveat: page 1 is hour-cached on the server
 * (see app/(main)/page.tsx) while pages 2+ are fetched fresh. If install
 * counts shift enough to reorder skills between those snapshots, the cursor
 * from page 1 can point into a now-different ordering, causing a rare
 * duplicate or skipped skill at the boundary. Acceptable given the daily
 * sync cadence; revisit if it ever becomes visible.
 */
export function DefaultSkillsList({
  initialPage,
  sheetHandle,
}: DefaultSkillsListProps) {
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
      initialData: { pages: [initialPage], pageParams: [null as string | null] },
      getNextPageParam: (last) => (last.isDone ? undefined : last.continueCursor),
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

  const skills: SkillData[] = (data?.pages ?? []).flatMap((p) =>
    p.page.map((r) => ({
      source: r.source,
      skillId: r.skillId,
      name: r.name,
      description: r.description,
      installs: r.installs,
      isDelisted: r.isDelisted,
      hasContentFetchError: r.hasContentFetchError,
    })),
  );

  if (skills.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-10 text-center">
        <p className="text-sm text-muted-foreground">
          No skills available yet.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Check back soon — skills sync daily.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="mb-4">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          Popular skills
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Sorted by installs from{" "}
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
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      {isFetchingNextPage && (
        <div className="flex items-center justify-center gap-2 mt-4 text-muted-foreground">
          <DotMatrixComet size="xs" ariaLabel="Loading more skills" />
          <span className="text-xs">Loading more skills…</span>
        </div>
      )}
    </div>
  );
}
