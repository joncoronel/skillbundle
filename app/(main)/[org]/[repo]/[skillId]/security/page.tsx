import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import {
  SkillSecurityTab,
  SkillSecurityTabSkeleton,
} from "@/components/skill-security-tab";
import { DataErrorBoundary } from "@/components/data-error-boundary";
import { loadSkill } from "@/lib/skill-cache";
import { buildSkillInstallCommand } from "@/lib/install-commands";

type Params = Promise<{ org: string; repo: string; skillId: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { org, repo, skillId } = await params;
  const skill = await loadSkill(`${org}/${repo}`, skillId);
  if (!skill) return { title: "Skill Not Found | SkillBundle" };

  const title = `${skill.name} security | SkillBundle`;
  const description = `Security audit verdicts for ${skill.name} from skills.sh's audit partners.`;
  return {
    title,
    description,
    openGraph: { title, description, type: "article" },
  };
}

export default async function SkillSecurityPage({
  params,
}: {
  params: Params;
}) {
  const { org, repo, skillId } = await params;
  const source = `${org}/${repo}`;
  if (buildSkillInstallCommand(source, skillId) === null) notFound();

  return (
    <DataErrorBoundary label="this skill's security audits">
      <Suspense fallback={<SkillSecurityTabSkeleton />}>
        <SkillSecurityTab source={source} skillId={skillId} />
      </Suspense>
    </DataErrorBoundary>
  );
}
