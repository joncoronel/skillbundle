"use client";

import { useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { SkillCard, type SkillData } from "@/components/skill-card";
import { SkillDetailSheet } from "@/components/skill-detail-sheet";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton";
import { Button } from "@/components/ui/cubby-ui/button";
import { cn } from "@/lib/utils";

interface SkillSearchResultsProps {
  /** Trimmed query string driving the search. Empty string = no search. */
  query: string;
}

/**
 * Renders results for a Convex full-text search over skill names.
 * Driven by an external query prop — the input itself lives in the parent
 * (skill-explorer) so the same input can swap between text + repo modes.
 */
export function SkillSearchResults({ query }: SkillSearchResultsProps) {
  const [activeSkill, setActiveSkill] = useState<SkillData | null>(null);

  const { results, status, loadMore } = usePaginatedQuery(
    api.skills.searchSkills,
    query ? { query } : "skip",
    { initialNumItems: 25 },
  );

  if (!query) return null;

  const isLoading = status === "LoadingFirstPage";
  const skills: SkillData[] = results.map((r) => ({
    source: r.source,
    skillId: r.skillId,
    name: r.name,
    description: r.description,
    installs: r.installs,
    technologies: [],
    isDelisted: r.isDelisted,
    hasContentFetchError: r.hasContentFetchError,
  }));

  return (
    <div className="mt-4">
      {isLoading ? (
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
                <SkillCard
                  key={`${skill.source}/${skill.skillId}`}
                  skill={skill}
                  selectable
                  variant="row"
                  onViewDetail={() => setActiveSkill(skill)}
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
          {status === "CanLoadMore" && (
            <div className="flex justify-center mt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => loadMore(25)}
              >
                Load more
              </Button>
            </div>
          )}
          {status === "LoadingMore" && (
            <div className="flex justify-center mt-4">
              <span className="text-xs text-muted-foreground">Loading…</span>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-8">
          No skills found for &ldquo;{query}&rdquo;
        </p>
      )}

      <SkillDetailSheet
        open={activeSkill !== null}
        onOpenChange={(open) => {
          if (!open) setActiveSkill(null);
        }}
        skill={activeSkill}
      />
    </div>
  );
}
