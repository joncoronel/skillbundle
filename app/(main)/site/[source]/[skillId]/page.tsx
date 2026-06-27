import type { Metadata } from "next";
import Link from "next/link";
import { GlobalSearchIcon } from "@hugeicons/core-free-icons";
import {
  loadSkill,
  SkillDetailPage,
} from "@/components/skill-detail-page";
import { representativeWellKnownSkill } from "@/lib/representative-params";

type Params = Promise<{ source: string; skillId: string }>;

// One representative skill is prerendered so Next can extract this route's App
// Shell; every other skill is served that shell instantly (via loading.tsx) and
// upgraded in the background on its first visit.
export async function generateStaticParams() {
  const { source, skillId } = await representativeWellKnownSkill();
  return [{ source, skillId }];
}

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
  const installCommand = `npx skills add ${source}/${skillId}`;

  return (
    <SkillDetailPage
      source={source}
      skillId={skillId}
      installCommand={installCommand}
      externalUrl={`https://${source}`}
      externalIcon={GlobalSearchIcon}
      externalLabel={source}
      breadcrumb={
        <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-6">
          <Link href="/" className="hover:text-foreground transition-colors">
            Home
          </Link>
          <span>/</span>
          <Link
            href={`/site/${source}`}
            className="hover:text-foreground transition-colors"
          >
            {source}
          </Link>
          <span>/</span>
          <span className="text-foreground">{skillId}</span>
        </nav>
      }
    />
  );
}
