import type { Metadata, ResolvingMetadata } from "next";
import { notFound } from "next/navigation";
import { SkillTabPage, skillTabMetadata } from "@/lib/skill-tab-route";
import { isSafeSkillRef } from "@/lib/install-commands";

type Params = Promise<{ org: string; repo: string; skillId: string }>;

export async function generateMetadata(
  { params }: { params: Params },
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const { org, repo, skillId } = await params;
  const source = `${org}/${repo}`;
  return skillTabMetadata("copies", source, skillId, parent);
}

export default async function Page({ params }: { params: Params }) {
  const { org, repo, skillId } = await params;
  const source = `${org}/${repo}`;
  if (!isSafeSkillRef(source, skillId)) notFound();
  return <SkillTabPage tab="copies" source={source} skillId={skillId} />;
}
