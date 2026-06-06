import type { Metadata } from "next";
import Link from "next/link";
import { GithubIcon } from "@hugeicons/core-free-icons";
import {
  loadSkill,
  SkillDetailPage,
} from "@/components/skill-detail-page";

type Params = Promise<{ org: string; repo: string; skillId: string }>;

// Classic ISR. We prebuild nothing at build time; each skill is generated on
// its first request and cached (dynamicParams defaults to true). The route's
// `loading.tsx` shows a skeleton during that first generation, and repeat
// visits serve the cached page until `revalidate` elapses.
export const revalidate = 86400; // 1 day
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
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
