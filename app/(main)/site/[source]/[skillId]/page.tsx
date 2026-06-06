import type { Metadata } from "next";
import { Suspense } from "react";
import {
  loadSkill,
  CachedSkillDetail,
  SkillDetailContentSkeleton,
} from "@/components/skill-detail-page";

type Params = Promise<{ source: string; skillId: string }>;

// Instant navigation (Cache Components) — same pattern as the GitHub skill
// route. See that file for why `prefetch: "static"` + disabled validation.
export const unstable_instant = {
  prefetch: "static",
  unstable_disableValidation: true,
};

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

export default function WellKnownSkillPage({ params }: { params: Params }) {
  return (
    <div className="mx-auto max-w-5xl px-4 pt-12 pb-24">
      <Suspense fallback={<SkillDetailContentSkeleton />}>
        {params.then(({ source, skillId }) => (
          <CachedSkillDetail source={source} skillId={skillId} variant="site" />
        ))}
      </Suspense>
    </div>
  );
}
