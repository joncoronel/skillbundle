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
// while it renders; a warm one appears instantly.
//
// `prefetch: "static"` makes a prefetch fetch only the static shell, so a
// listing that links to many skills does NOT render (and Convex-query) every
// row on load — the render happens on the actual click instead. `"runtime"`
// would re-render each prefetched route at request time (a Convex query per
// skill, every reload), which is the behavior we're avoiding.
//
// Validation is disabled because `"static"` validation renders the cached
// content with placeholder params, which our strict Convex query rejects. The
// structure itself is correct (it validated under `"runtime"` + samples).
export const unstable_instant = {
  prefetch: "static",
  unstable_disableValidation: true,
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
