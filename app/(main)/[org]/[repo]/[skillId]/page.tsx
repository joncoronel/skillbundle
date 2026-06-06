import type { Metadata } from "next";
import Link from "next/link";
import { GithubIcon } from "@hugeicons/core-free-icons";
import { loadSkill, SkillDetailPage } from "@/components/skill-detail-page";

type Params = Promise<{ org: string; repo: string; skillId: string }>;

// We deliberately prebuild nothing real at build time. Cache Components only
// requires `generateStaticParams` to return at least one param to turn on the
// render-and-save behavior; with `dynamicParams` at its default (`true`), every
// skill is rendered and saved to disk on its first request and served from
// cache thereafter. Popular skills get built naturally as they're visited, so
// there's no reason to fan out Convex reads at build time. The lone placeholder
// satisfies the validator and resolves to `notFound()`.
export function generateStaticParams() {
  return [
    { org: "__placeholder__", repo: "__placeholder__", skillId: "__placeholder__" },
  ];
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

// `await params` at the top makes the whole page the unit Cache Components
// renders and SAVES on first request (see SkillDetailPage). Repeat visits get
// the saved HTML — no skeleton, no Convex read. The first-visit skeleton comes
// from `loading.tsx`.
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
