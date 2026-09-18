import type { Metadata, ResolvingMetadata } from "next";
import { SkillTabPage, skillTabMetadata } from "@/lib/skill-tab-route";

type Params = Promise<{ org: string; repo: string; skillId: string }>;

export async function generateMetadata(
  { params }: { params: Params },
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const { org, repo, skillId } = await params;
  const source = `${org}/${repo}`;
  return skillTabMetadata("stats", source, skillId, parent);
}

export default async function Page({ params }: { params: Params }) {
  const { org, repo, skillId } = await params;
  const source = `${org}/${repo}`;
  return <SkillTabPage tab="stats" source={source} skillId={skillId} />;
}
