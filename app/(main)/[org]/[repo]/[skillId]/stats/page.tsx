import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SkillTabPage, skillTabMetadata } from "@/lib/skill-tab-route";
import { buildSkillInstallCommand } from "@/lib/install-commands";

type Params = Promise<{ org: string; repo: string; skillId: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { org, repo, skillId } = await params;
  const source = `${org}/${repo}`;
  return skillTabMetadata("stats", source, skillId);
}

export default async function Page({ params }: { params: Params }) {
  const { org, repo, skillId } = await params;
  const source = `${org}/${repo}`;
  if (buildSkillInstallCommand(source, skillId) === null) notFound();
  return <SkillTabPage tab="stats" source={source} skillId={skillId} />;
}
