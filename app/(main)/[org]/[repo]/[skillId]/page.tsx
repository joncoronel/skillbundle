import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GithubIcon } from "@hugeicons/core-free-icons";
import { SkillDetailPage } from "@/components/skill-detail-page";
import { loadSkill } from "@/lib/skill-cache";
import { buildSkillInstallCommand } from "@/lib/install-commands";

type Params = Promise<{ org: string; repo: string; skillId: string }>;

// generateStaticParams lives on this segment's layout.tsx — one representative
// skill covers the Overview and every tab route.

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { org, repo, skillId } = await params;
  const source = `${org}/${repo}`;

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
    openGraph: {
      title,
      description,
      type: "article",
    },
  };
}

export default async function SkillPage({ params }: { params: Params }) {
  const { org, repo, skillId } = await params;
  const source = `${org}/${repo}`;
  const installCommand = buildSkillInstallCommand(source, skillId);
  if (installCommand === null) notFound();

  return (
    <SkillDetailPage
      source={source}
      skillId={skillId}
      installCommand={installCommand}
      externalUrl={`https://github.com/${source}`}
      externalIcon={GithubIcon}
      externalLabel={source}
    />
  );
}
