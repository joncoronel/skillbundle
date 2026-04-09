"use client";

import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import { SkillCard, type SkillData } from "@/components/skill-card";
import { SkillDetailSheet } from "@/components/skill-detail-sheet";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton";
import { Badge } from "@/components/ui/cubby-ui/badge";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/cubby-ui/collapsible";
import { cn, formatInstalls } from "@/lib/utils";

type AnalyzeRepoResult = Awaited<
  ReturnType<ReturnType<typeof useAction<typeof api.recommendations.analyzeRepo>>>
>;
type GroupedRecommendation = AnalyzeRepoResult["recommendations"][number];
type Variant = GroupedRecommendation["variants"][number];

interface RepoAnalysisResultsProps {
  /** Trimmed repo URL — empty string disables the analysis. */
  repoUrl: string;
  /** When the URL changes, the parent should bump this signal to re-trigger. */
  triggerKey: number;
  canAutoDetect: boolean;
}

/**
 * Calls the Convex `analyzeRepo` action when `triggerKey` changes (the parent
 * controls submission timing). Displays the fingerprint chips and ranked
 * recommendations.
 */
export function RepoAnalysisResults({
  repoUrl,
  triggerKey,
  canAutoDetect,
}: RepoAnalysisResultsProps) {
  const analyzeRepo = useAction(api.recommendations.analyzeRepo);
  const [result, setResult] = useState<AnalyzeRepoResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSkill, setActiveSkill] = useState<SkillData | null>(null);

  useEffect(() => {
    if (triggerKey === 0) return; // Initial mount — don't auto-run
    const trimmed = repoUrl.trim();
    if (!trimmed) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    analyzeRepo({ repoUrl: trimmed })
      .then((res) => {
        if (cancelled) return;
        if (res.error) {
          setError(res.error);
          setResult(null);
        } else {
          setResult(res);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError("Failed to analyze repository. Please check the URL.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerKey]);

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

  if (loading) {
    return (
      <div className="mt-4 grid gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-12 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="mt-4 text-sm text-destructive">{error}</p>;
  }

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

  function openSkillDetail(variant: Variant, name: string) {
    setActiveSkill({
      source: variant.source,
      skillId: variant.skillId,
      name,
      description: variant.description,
      installs: variant.installs,
      technologies: [],
    });
  }

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
              technologies: [],
            };
            return (
              <SkillCard
                key={`singleton:${variant.source}/${variant.skillId}`}
                skill={skill}
                selectable
                variant="row"
                onViewDetail={() => setActiveSkill(skill)}
                className={positionClassName}
              />
            );
          }

          return (
            <SkillGroupRow
              key={`group:${group.name}`}
              group={group}
              className={positionClassName}
              onSelectVariant={(variant) =>
                openSkillDetail(variant, group.name)
              }
            />
          );
        })}
      </div>

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

// ---------------------------------------------------------------------------
// Group row — collapsible row for skills with multiple variants
// ---------------------------------------------------------------------------

interface SkillGroupRowProps {
  group: GroupedRecommendation;
  className?: string;
  onSelectVariant: (variant: Variant) => void;
}

function SkillGroupRow({
  group,
  className,
  onSelectVariant,
}: SkillGroupRowProps) {
  const visibleCount = group.variants.length;
  const cappedRemainder = group.variantCount - visibleCount;

  return (
    <Collapsible
      className={cn(
        "text-card-foreground flex flex-col bg-card rounded-2xl border dark:border-border/50",
        "transition-colors hover:border-border/20",
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
        <div className="border-t dark:border-border/50">
          {group.variants.map((variant) => (
            <button
              key={`${variant.source}/${variant.skillId}`}
              type="button"
              onClick={() => onSelectVariant(variant)}
              className={cn(
                "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm",
                "border-b last:border-b-0 dark:border-border/50",
                "hover:bg-muted/50 transition-colors",
              )}
            >
              <span className="text-muted-foreground truncate">
                {variant.source}
              </span>
              <span className="ml-auto text-xs font-mono tabular-nums text-muted-foreground shrink-0">
                {formatInstalls(variant.installs)}
              </span>
            </button>
          ))}
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

