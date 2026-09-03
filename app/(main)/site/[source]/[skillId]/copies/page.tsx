import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SkillTabPage, skillTabMetadata } from "@/lib/skill-tab-route";
import { buildSkillInstallCommand } from "@/lib/install-commands";

type Params = Promise<{ source: string; skillId: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { source, skillId } = await params;
  return skillTabMetadata("copies", source, skillId);
}

export default async function Page({ params }: { params: Params }) {
  const { source, skillId } = await params;
  if (buildSkillInstallCommand(source, skillId) === null) notFound();
  return <SkillTabPage tab="copies" source={source} skillId={skillId} />;
}
