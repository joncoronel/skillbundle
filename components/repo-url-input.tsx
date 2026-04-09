"use client";

import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { SkillCard, type SkillData } from "@/components/skill-card";
import { SkillDetailSheet } from "@/components/skill-detail-sheet";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton";
import { Badge } from "@/components/ui/cubby-ui/badge";
import { cn } from "@/lib/utils";

type AnalyzeRepoResult = Awaited<ReturnType<ReturnType<typeof useAction<typeof api.recommendations.analyzeRepo>>>>;

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

  const skills: SkillData[] = recs.map((r) => ({
    source: r.source,
    skillId: r.skillId,
    name: r.name,
    description: r.description,
    installs: r.installs,
    technologies: [],
  }));

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
                      : cn("rounded-none border-t-0")
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
