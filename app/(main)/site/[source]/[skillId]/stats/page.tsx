import type { Metadata, ResolvingMetadata } from "next";
import { notFound } from "next/navigation";
import { SkillTabPage, skillTabMetadata } from "@/lib/skill-tab-route";
import { isSafeSkillRef } from "@/lib/install-commands";

type Params = Promise<{ source: string; skillId: string }>;

export async function generateMetadata(
  { params }: { params: Params },
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const { source, skillId } = await params;
  return skillTabMetadata("stats", source, skillId, parent);
}

export default async function Page({ params }: { params: Params }) {
  const { source, skillId } = await params;
  if (!isSafeSkillRef(source, skillId)) notFound();
  return <SkillTabPage tab="stats" source={source} skillId={skillId} />;
}
