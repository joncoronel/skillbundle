import type { Metadata } from "next";
import { loadSkill, CachedSkillDetail } from "@/components/skill-detail-page";

type Params = Promise<{ source: string; skillId: string }>;

// Full-page caching — same shape as the GitHub skill route. The page is a
// prerender: an on-demand skill renders once and is saved to the durable route
// cache, then served from cache on repeat visits (no per-request Convex). Only
// the data functions in CachedSkillDetail are `use cache`; the UI renders inline
// so the rendered HTML is part of the saved page, not an ephemeral runtime hole.
//
// cacheComponents requires at least one entry here for build-time validation; we
// prebuild a single known skill and the rest generate on first request.
export async function generateStaticParams() {
  return [{ source: "open.feishu.cn", skillId: "lark-approval" }];
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

export default async function WellKnownSkillPage({ params }: { params: Params }) {
  const { source, skillId } = await params;

  return (
    <div className="mx-auto max-w-5xl px-4 pt-12 pb-24">
      <CachedSkillDetail source={source} skillId={skillId} variant="site" />
    </div>
  );
}
