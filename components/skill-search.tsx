"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { SelectableSkillRow, type SkillData } from "@/components/skill-card";
import type { SkillDetailHandle } from "@/components/skill-detail-sheet";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { cn } from "@/lib/utils";

interface SkillSearchResultsProps {
  /** Trimmed query string driving the search. Empty string = no search. */
  query: string;
  sheetHandle: SkillDetailHandle;
}

/**
 * Renders results for a Convex full-text search over skill names.
 * Uses TanStack Query (via convexQuery) for caching + live reactivity.
 * Driven by an external query prop — the input itself lives in the parent
 * (skill-explorer) so the same input can swap between text + repo modes.
 */
export function SkillSearchResults({
  query,
  sheetHandle,
}: SkillSearchResultsProps) {

  const { data, isPending } = useQuery({
    ...convexQuery(api.skills.searchSkills, query ? { query } : "skip"),
    gcTime: 5 * 60_000,
  });

  const skills: SkillData[] = useMemo(
    () =>
      (data ?? []).map((r) => ({
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
        trendingRank: r.trendingRank,
        hotChange: r.hotChange,
      })),
    [data],
  );

  if (!query) return null;

  return (
    <div className="mt-4">
      {isPending ? (
        <>
          <Skeleton className="h-4 w-20 mb-3" />
          <div className="grid">
            {Array.from({ length: 16 }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 bg-card border dark:border-border/50",
                  i === 0 ? "rounded-t-2xl" : "border-t-0",
                  i === 15 ? "rounded-b-2xl" : "",
                )}
              >
                <Skeleton className="size-4 rounded-sm shrink-0" />
                <Skeleton className="h-5 w-28 rounded-sm" />
                <Skeleton className="h-5 w-16 rounded-sm" />
                <Skeleton className="ml-auto h-4 w-10 shrink-0 rounded-sm" />
              </div>
            ))}
          </div>
        </>
      ) : skills.length > 0 ? (
        <>
          <p className="text-xs text-muted-foreground mb-3">
            {skills.length} result{skills.length !== 1 && "s"}
          </p>
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
        </>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-8">
          No skills found for &ldquo;{query}&rdquo;
        </p>
      )}

    </div>
  );
}
