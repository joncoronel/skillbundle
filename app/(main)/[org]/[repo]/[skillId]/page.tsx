import type { Metadata } from "next";
import Link from "next/link";
import { GithubIcon } from "@hugeicons/core-free-icons";
import {
  loadSkill,
  SkillDetailPage,
} from "@/components/skill-detail-page";
import { representativeGitHubSkill } from "@/lib/representative-params";

type Params = Promise<{ org: string; repo: string; skillId: string }>;

// One representative skill is prerendered so Next can extract this route's App
// Shell; every other skill is served that shell instantly (via loading.tsx) and
// upgraded in the background on its first visit.
export async function generateStaticParams() {
  const { source, skillId } = await representativeGitHubSkill();
  const [org, repo] = source.split("/");
  return [{ org, repo, skillId }];
}

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
  const installCommand = `npx skills add ${source} --skill ${skillId}`;

  return (
    <SkillDetailPage
      source={source}
      skillId={skillId}
      installCommand={installCommand}
      externalUrl={`https://github.com/${source}`}
      externalIcon={GithubIcon}
      externalLabel={source}
      breadcrumb={
        <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-6">
          <Link href="/" className="hover:text-foreground transition-colors">
            Home
          </Link>
          <span>/</span>
          <Link
            href={`/${org}`}
            className="hover:text-foreground transition-colors"
          >
            {org}
          </Link>
          <span>/</span>
          <Link
            href={`/${source}`}
            className="hover:text-foreground transition-colors"
          >
            {repo}
          </Link>
          <span>/</span>
          <span className="text-foreground">{skillId}</span>
        </nav>
      }
    />
  );
}
