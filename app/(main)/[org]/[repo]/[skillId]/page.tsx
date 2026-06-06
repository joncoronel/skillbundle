import type { Metadata } from "next";
import { loadSkill, CachedSkillDetail } from "@/components/skill-detail-page";

type Params = Promise<{ org: string; repo: string; skillId: string }>;

// Prerendered, generated on demand. We don't prebuild any skill at build time
// (the full set times out hitting Convex), so `generateStaticParams` returns []
// and `dynamicParams` lets unknown skills render on first request. The point of
// this shape: the page render (including `loadSkill`/`loadAudits` inside the
// `use cache` `CachedSkillDetail`) gets baked into the *prerendered* output,
// which Vercel stores durably and serves from cache on repeat visits. That's the
// path where `use cache` actually persists on serverless — the prerender, not
// the ephemeral in-memory runtime cache that a request-time dynamic hole uses.
// First (cold) visit shows `loading.tsx`; repeat visits are instant, no Convex.
// (Under cacheComponents, params outside generateStaticParams are generated on
// demand implicitly — no `dynamicParams` export, it's not allowed here.)
//
// cacheComponents requires at least one entry here so it can build-time validate
// there are no uncaught dynamic accesses. We prebuild a single known skill; the
// rest generate on the first request and are then cached.
export async function generateStaticParams() {
  return [{ org: "vercel-labs", repo: "skills", skillId: "find-skills" }];
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

  return (
    <div className="mx-auto max-w-5xl px-4 pt-12 pb-24">
      <CachedSkillDetail
        source={`${org}/${repo}`}
        skillId={skillId}
        variant="github"
      />
    </div>
  );
}
