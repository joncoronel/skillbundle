import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import {
  SkillHistoryTab,
  SkillHistoryTabSkeleton,
} from "@/components/skill-history-tab";
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

  const title = `${skill.name} history | SkillBundle`;
  const description = `Every change SkillBundle has recorded to ${skill.name}'s skill file.`;
  return {
    title,
    description,
    openGraph: { title, description, type: "article" },
  };
}

export default async function WellKnownSkillHistoryPage({
  params,
}: {
  params: Params;
}) {
  const { source, skillId } = await params;
  if (buildSkillInstallCommand(source, skillId) === null) notFound();

  return (
    <DataErrorBoundary label="this skill's history">
      <Suspense fallback={<SkillHistoryTabSkeleton />}>
        <SkillHistoryTab source={source} skillId={skillId} />
      </Suspense>
    </DataErrorBoundary>
  );
}
