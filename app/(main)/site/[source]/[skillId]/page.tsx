import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GlobalSearchIcon } from "@hugeicons/core-free-icons";
import { SkillDetailPage } from "@/components/skill-detail-page";
import { loadSkill } from "@/lib/skill-cache";
import { buildSkillInstallCommand } from "@/lib/install-commands";

type Params = Promise<{ source: string; skillId: string }>;

// generateStaticParams lives on this segment's layout.tsx — one representative
// skill covers the Overview and every tab route.

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { source, skillId } = await params;
  const skill = await loadSkill(source, skillId);

  if (!skill) {
    return { title: "Skill Not Found | SkillBundle" };
  }

  const title = `${skill.name} | SkillBundle`;
  const description =
    skill.description ?? `${skill.name} — a skill from ${source}`;

  return {
    title,
    description,
    openGraph: { title, description, type: "article" },
  };
}

export default async function WellKnownSkillPage({
  params,
}: {
  params: Params;
}) {
  const { source, skillId } = await params;
  const installCommand = buildSkillInstallCommand(source, skillId);
  if (installCommand === null) notFound();

  return (
    <SkillDetailPage
      source={source}
      skillId={skillId}
      installCommand={installCommand}
      externalUrl={`https://${source}`}
      externalIcon={GlobalSearchIcon}
      externalLabel={source}
    />
  );
}
