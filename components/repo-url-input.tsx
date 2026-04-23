"use client";

import { useQuery } from "@tanstack/react-query";
import { useConvex } from "convex/react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import type { AnalyzeRepoResult } from "@/convex/recommendations";
import { SelectableSkillRow, type SkillData } from "@/components/skill-card";
import type { SkillDetailHandle } from "@/components/skill-detail-sheet";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { Badge } from "@/components/ui/cubby-ui/badge";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/cubby-ui/collapsible";
import { cn } from "@/lib/utils";
type GroupedRecommendation = AnalyzeRepoResult["recommendations"][number];


interface RepoAnalysisResultsProps {
  /** The repo URL from the URL param. Empty = no analysis yet. */
  repoUrl: string;
  canAutoDetect: boolean;
  sheetHandle: SkillDetailHandle;
}

/**
 * Fetches repo analysis results via TanStack Query, keyed on the repo URL
 * param. The URL is only set when the user clicks Analyze, so typing in the
 * input doesn't trigger fetches. Tab switches don't re-fetch, and
 * re-analyzing the same repo is a cache hit.
 */
export function RepoAnalysisResults({
  repoUrl,
  canAutoDetect,
  sheetHandle,
}: RepoAnalysisResultsProps) {
  const convex = useConvex();

  const trimmedUrl = repoUrl.trim();

  const { data, isPending, error } = useQuery<AnalyzeRepoResult>({
    queryKey: ["repo", "analyze", trimmedUrl],
    queryFn: () =>
      convex.action(api.recommendations.analyzeRepo, {
        repoUrl: trimmedUrl,
      }),
    enabled: !!trimmedUrl,
    staleTime: 10 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
  });

  if (!canAutoDetect) {
    return (
      <p className="mt-4 text-xs text-muted-foreground">
        <Link href="/pricing" className="underline hover:text-foreground">
          Upgrade to Pro
        </Link>{" "}
        to auto-detect skills from a GitHub repo.
      </p>
    );
  }

  const loading = isPending && !!trimmedUrl;
  const actionError = error
    ? error.message || "Something went wrong analyzing this repository. Please try again."
    : data?.error ?? null;

  if (loading) {
    return (
      <div className="mt-4 grid gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-12 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (actionError) {
    return <p className="mt-4 text-sm text-destructive">{actionError}</p>;
  }

  const result = data;
  if (!result) return null;

  const recs = result.recommendations;
  const fingerprint = result.fingerprint;

  if (recs.length === 0) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        No matching skills found for {result.repoName}.
      </p>
    );
  }

  const chipPackages = fingerprint?.packages.slice(0, 12) ?? [];



  return (
    <div className="mt-4">
      {fingerprint && (
        <div className="mb-4">
          <p className="text-xs text-muted-foreground mb-2">
            Detected in {result.repoName}
            {fingerprint.languages.length > 0 &&
              ` · ${fingerprint.languages.join(", ")}`}
          </p>
          {chipPackages.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {chipPackages.map((pkg) => (
                <Badge
                  key={pkg}
                  variant="secondary"
                  className="text-[10px] px-1.5 py-0.5"
                >
                  {pkg}
                </Badge>
              ))}
              {fingerprint.packages.length > chipPackages.length && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">
                  +{fingerprint.packages.length - chipPackages.length}
                </Badge>
              )}
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground mb-3">
        {recs.length} recommended skill{recs.length !== 1 && "s"}
      </p>
      <div className="grid">
        {recs.map((group, i) => {
          const isFirst = i === 0;
          const isLast = i === recs.length - 1;
          const isSolo = recs.length === 1;
          const positionClassName = isSolo
            ? undefined
            : isFirst
              ? "rounded-b-none"
              : isLast
                ? "rounded-t-none border-t-0"
                : cn("rounded-none border-t-0");

          if (group.variantCount === 1) {
            const variant = group.variants[0];
            const skill: SkillData = {
              source: variant.source,
              skillId: variant.skillId,
              name: group.name,
              description: variant.description,
              installs: variant.installs,
            };
            return (
              <SelectableSkillRow
                key={`singleton:${variant.source}/${variant.skillId}`}
                skill={skill}
                sheetHandle={sheetHandle}
                className={positionClassName}
              />
            );
          }

          return (
            <SkillGroupRow
              key={`group:${group.name}`}
              group={group}
              className={positionClassName}
              sheetHandle={sheetHandle}
            />
          );
        })}
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Group row — collapsible row for skills with multiple variants
// ---------------------------------------------------------------------------

interface SkillGroupRowProps {
  group: GroupedRecommendation;
  className?: string;
  sheetHandle: SkillDetailHandle;
}

function SkillGroupRow({
  group,
  className,
  sheetHandle,
}: SkillGroupRowProps) {
  const visibleCount = group.variants.length;
  const cappedRemainder = group.variantCount - visibleCount;

  return (
    <Collapsible
      className={cn(
        "text-card-foreground flex flex-col bg-card rounded-2xl border dark:border-border/50",
        // overflow-hidden lets the outer rounded-2xl clip the inner muted
        // section's square corners, so we don't need to round each child.
        "overflow-hidden",
        "transition-colors",
        // Selection-border continuity at group boundaries:
        //
        // 1) Color the group's bottom border when followed by a checked
        //    singleton. The singleton has border-t-0 in the outer-list merge,
        //    so its visual top edge IS the group's bottom edge.
        "[&:has(+_label_[data-checked])]:border-b-primary/30",
        // 2) Color the group's left + right borders when ANY variant inside
        //    it is checked. Variants have border-x-0 (no horizontal borders
        //    of their own), so the only paintable L/R edges in this region
        //    belong to the outer Collapsible. The orange tints the whole
        //    group's sides, signaling "a variant inside this group is
        //    selected" — without introducing any new borders.
        "has-[label[data-checked]]:border-x-primary/30 dark:has-[label[data-checked]]:border-x-primary/30",
        className,
      )}
    >
      <CollapsibleTrigger
        className={cn(
          "border-none bg-transparent shadow-none ring-0 hover:bg-transparent hover:opacity-80",
          "py-3 px-4 w-full",
        )}
      >
        <div className="flex items-center gap-3 w-full">
          <span className="text-sm font-semibold text-left">{group.name}</span>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {group.variantCount} versions
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            strokeWidth={2}
            className="size-4 text-muted-foreground transition-transform duration-200 group-data-panel-open/collapsible:rotate-180"
          />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="max-sm:duration-0">
        {/* Nested section: muted background visually shows that variants
            are children of the group row above. Each variant is rendered
            as a SelectableSkillRow so it inherits the same checkbox +
            click-row vs click-name behavior the singleton rows use.

            The `border-t` is the visual top edge of the first variant
            (since variants have border-t-0). Color it orange when the
            first variant is selected so the selection's top edge visually
            connects to the rest of its border. */}
        <div className="border-t bg-muted dark:border-border/50 [&:has(>_label:first-child[data-checked])]:border-t-primary/30">
          {group.variants.map((variant, i) => {
            const skill: SkillData = {
              source: variant.source,
              skillId: variant.skillId,
              name: group.name,
              description: variant.description,
              installs: variant.installs,
            };
            const isLast = i === group.variants.length - 1;
            return (
              <SelectableSkillRow
                key={`${variant.source}/${variant.skillId}`}
                skill={skill}
                sheetHandle={sheetHandle}
                className={cn(
                  // Square the corners and remove the standalone card border
                  // so variants render as one continuous list inside the
                  // expanded section. The bottom-most variant retains the
                  // bottom-rounding from the wrapper div.
                  "rounded-none border-x-0 border-t-0 bg-transparent",
                  isLast && cappedRemainder === 0 && "border-b-0",
                )}
              />
            );
          })}
          {cappedRemainder > 0 && (
            <div className="px-4 py-2 text-xs text-muted-foreground">
              showing {visibleCount} of {group.variantCount} versions
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
