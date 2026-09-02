import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import {
  SkillStatsTab,
  SkillStatsTabSkeleton,
} from "@/components/skill-stats-tab";
import { DataErrorBoundary } from "@/components/data-error-boundary";
import { loadSkill } from "@/lib/skill-cache";
import { buildSkillInstallCommand } from "@/lib/install-commands";

type Params = Promise<{ source: string; skillId: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { source, skillId } = await params;
  const skill = await loadSkill(source, skillId);
  if (!skill) return { title: "Skill Not Found | SkillBundle" };

  const title = `${skill.name} stats | SkillBundle`;
  const description = `Install count and daily install history for ${skill.name}, recorded once a day.`;
  return {
    title,
    description,
    openGraph: { title, description, type: "article" },
  };
}

export default async function WellKnownSkillStatsPage({
  params,
}: {
  params: Params;
}) {
  const { source, skillId } = await params;
  if (buildSkillInstallCommand(source, skillId) === null) notFound();

  return (
    <DataErrorBoundary label="this skill's stats">
      <Suspense fallback={<SkillStatsTabSkeleton />}>
        <SkillStatsTab source={source} skillId={skillId} />
      </Suspense>
    </DataErrorBoundary>
  );
}
