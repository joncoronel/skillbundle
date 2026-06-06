import type { Metadata } from "next";
import { Suspense } from "react";
import {
  loadSkill,
  CachedSkillDetail,
  SkillDetailContentSkeleton,
} from "@/components/skill-detail-page";

type Params = Promise<{ org: string; repo: string; skillId: string }>;

// Instant navigation (Cache Components). The page is NOT async — params are read
// inside the <Suspense> via `.then()`, and the content is cached per skill in
// `CachedSkillDetail` (`use cache`).
//
// `prefetch: "runtime"` renders the route on prefetch so warm pages are fully
// cached (instant click, no skeleton). This relies on `use cache` actually
// persisting on Vercel — see the ConvexHttpClient note in skill-detail-page.tsx.
// If it persists, the prefetch render is a one-time warm per skill.
export const unstable_instant = {
  prefetch: "runtime",
  samples: [
    { params: { org: "vercel-labs", repo: "skills", skillId: "find-skills" } },
  ],
};

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

export default function SkillPage({ params }: { params: Params }) {
  return (
    <div className="mx-auto max-w-5xl px-4 pt-12 pb-24">
      <Suspense fallback={<SkillDetailContentSkeleton />}>
        {params.then(({ org, repo, skillId }) => (
          <CachedSkillDetail
            source={`${org}/${repo}`}
            skillId={skillId}
            variant="github"
          />
        ))}
      </Suspense>
    </div>
  );
}
