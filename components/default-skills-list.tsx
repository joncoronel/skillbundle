"use client";

import { useEffect, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useConvex } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { SkillRowView, type SkillData } from "@/components/skill-card";
import type { SkillDetailHandle } from "@/components/skill-detail-sheet";

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
      staleTime: 5 * 60_000,
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
      technologies: [],
      isDelisted: r.isDelisted,
      hasContentFetchError: r.hasContentFetchError,
    })),
  );

  if (skills.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No skills available yet.
      </p>
    );
  }

  return (
    <div className="mt-4">
      <p className="text-xs text-muted-foreground mb-3">Popular skills</p>
      <div className="grid">
        {skills.map((skill, i) => {
          const isFirst = i === 0;
          const isLast = i === skills.length - 1;
          const isSolo = skills.length === 1;
          return (
            <SkillRowView
              key={`${skill.source}/${skill.skillId}`}
              skill={skill}
              selectable
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
        <div className="flex justify-center mt-4">
          <span className="text-xs text-muted-foreground">Loading more…</span>
        </div>
      )}

    </div>
  );
}
