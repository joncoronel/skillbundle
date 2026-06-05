import type { Metadata } from "next";
import Link from "next/link";
import { GlobalSearchIcon } from "@hugeicons/core-free-icons";
import {
  loadSkill,
  SkillDetailShell,
  SkillDetailContent,
} from "@/components/skill-detail-page";

type Params = Promise<{ source: string; skillId: string }>;

// We deliberately prebuild nothing real at build time. Cache Components only
// requires `generateStaticParams` to return at least one param to turn on the
// render-and-save behavior; with `dynamicParams` at its default (`true`), every
// skill is rendered and saved to disk on its first request and served from
// cache thereafter. Popular skills get built naturally as they're visited, so
// there's no reason to fan out Convex reads at build time. The lone placeholder
// satisfies the validator and resolves to `notFound()`.
export function generateStaticParams() {
  return [{ source: "__placeholder__", skillId: "__placeholder__" }];
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

// The page itself is just the static shell — no `await params` here, so Cache
// Components can prerender and serve it instantly for any URL. Params are read
// inside the shell's Suspense boundary by `SkillContent`, so the body streams
// in behind the skeleton instead of blocking the response.
export default function WellKnownSkillPage({ params }: { params: Params }) {
  return (
    <SkillDetailShell>
      <SkillContent params={params} />
    </SkillDetailShell>
  );
}

async function SkillContent({ params }: { params: Params }) {
  const { source, skillId } = await params;
  const installCommand = `npx skills add ${source}/${skillId}`;

  return (
    <SkillDetailContent
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
