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
// `CachedSkillDetail` (`use cache`). A cold skill shows the skeleton fallback
// while it renders; a warm one appears instantly from the prefetched shell.
//
// `unstable_instant` validates this structure at dev/build time. We use
// `prefetch: "runtime"` with a real `samples` entry because validation renders
// the cached content against real data, and our Convex query rejects the
// placeholder params that `prefetch: "static"` would feed in.
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
