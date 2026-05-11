"use client";

import { useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
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
 * Renders results for a Convex full-text search over skill names. Uses
 * TanStack Query (via convexQuery) for caching + live reactivity. Driven
 * by an external `query` prop — the input itself lives in the parent
 * (skill-explorer) so the same input can swap between text + repo modes.
 *
 * **Coupled to parent visibility lifecycle.** This component is designed
 * to be kept mounted under a `<div hidden>` toggle (the parent shows/hides
 * via display:none, never unmounts). The `if (!query && !data) return null`
 * guard below relies on this contract — `placeholderData: keepPreviousData`
 * keeps prior rows in the tree during typing-modify ("f" → "fg"), and the
 * hide-toggle then avoids paying the 60-row mount cost on every browse ↔
 * search transition. **Reusing this component without the parent
 * hide-toggle will leave stale rows visible after the query is cleared.**
 */
export function SkillSearchResults({
  query,
  sheetHandle,
}: SkillSearchResultsProps) {
  const { data, isPending, isPlaceholderData } = useQuery({
    ...convexQuery(api.skills.searchSkills, query ? { query } : "skip"),
    // Keeps the prior query's rows mounted while the new key fetches, so an
    // in-session edit ("f" → "fg") stays stable instead of flashing skeleton.
    // Combined with the parent keeping this component mounted under
    // `<div hidden>`, this also avoids paying the 60-row mount cost on every
    // browse ↔ search toggle. The "did the user clear in between" signal
    // (which we need to fire skeleton for fresh-search-after-clear) is
    // tracked via `lastSettledQuery` below.
    placeholderData: keepPreviousData,
    // Suppress the background refetch that fires on every remount/key
    // switch — the convex subscription keeps cached data live, so a cached
    // hit doesn't need to re-hit the backend just to confirm freshness.
    staleTime: 60_000,
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

  // Track the query whose results are currently settled-displayed. Used to
  // distinguish "typing-modify" (`"f"` → `"fg"` without clearing) from
  // "fresh search after clear" (`"f"` → cleared → `"g"`):
  //   - On settle (data arrives for current query), set lastSettledQuery.
  //   - On clear (query becomes empty), reset to "".
  // Render-time state adjustment per the React docs' "adjusting state when
  // a prop changes" pattern; both updates are idempotent.
  const [lastSettledQuery, setLastSettledQuery] = useState("");
  if (data && !isPlaceholderData && query && query !== lastSettledQuery) {
    setLastSettledQuery(query);
  }
  if (!query && lastSettledQuery) {
    setLastSettledQuery("");
  }

  if (!query && !data) return null;

  // Skeleton fires when:
  //   - First-time fetch with no data anywhere yet (isPending), or
  //   - We're showing placeholder data for a previous query AND there's no
  //     recently-settled query to keep on screen — i.e. fresh search after
  //     clear. For typing-modify (lastSettledQuery is set), we keep the prior
  //     rows visible and surface the in-flight fetch via the inline spinner.
  const showSkeleton =
    query.length > 0 && (isPending || (isPlaceholderData && !lastSettledQuery));

  return (
    <div className="mt-4">
      {showSkeleton ? (
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
