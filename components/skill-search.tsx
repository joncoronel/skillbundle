"use client";

import { useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { SelectableSkillRow, type SkillData } from "@/components/skill-card";
import type { SkillDetailHandle } from "@/components/skill-detail-sheet";

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
 * to be kept mounted under a Crossfade pane toggle (the parent shows/hides
 * via display:none, never unmounts). The `if (!query && !data) return null`
 * guard below relies on this contract — `placeholderData: keepPreviousData`
 * keeps prior rows in the tree during typing-modify ("f" → "fg"), and the
 * hide-toggle then avoids paying the 60-row mount cost on every browse ↔
 * search transition. The parent also gates the pane on its `searchSettled`
 * state, so this component is only ever *visible* with real data for the
 * current search session — there is deliberately no loading skeleton here
 * (the leaderboard stays on screen while a fresh search is in flight, and
 * the input spinner signals progress). **Reusing this component without
 * the parent hide-toggle will leave stale rows visible after the query is
 * cleared.**
 */
export function SkillSearchResults({
  query,
  sheetHandle,
}: SkillSearchResultsProps) {
  const { data } = useQuery({
    ...convexQuery(api.skills.searchSkills, query ? { query } : "skip"),
    // Keeps the prior query's rows mounted while the new key fetches, so an
    // in-session edit ("f" → "fg") stays stable instead of flashing empty.
    // Combined with the parent keeping this component mounted in the hidden
    // Crossfade pane, this also avoids paying the 60-row mount cost on every
    // browse ↔ search toggle.
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

  if (!query && !data) return null;

  return (
    <div className="mt-4">
      {skills.length > 0 ? (
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
