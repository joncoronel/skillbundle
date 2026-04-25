import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { cacheLife } from "next/cache";
import { cache } from "react";
import { api } from "@/convex/_generated/api";
import { SkillPageContent } from "./skill-page-content";

type Params = Promise<{ org: string; repo: string; skillId: string }>;

const getSkill = cache((source: string, skillId: string) =>
  fetchQuery(api.skills.getBySourceAndSkillId, { source, skillId }),
);

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  "use cache";
  cacheLife("days");

  const { org, repo, skillId } = await params;
  const source = `${org}/${repo}`;

  const skill = await getSkill(source, skillId);

  if (!skill) {
    return { title: "Skill Not Found | SkillStack" };
  }

  const title = `${skill.name} | SkillStack`;
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
  "use cache";
  cacheLife("days");

  const { org, repo, skillId } = await params;
  const source = `${org}/${repo}`;

  const skill = await getSkill(source, skillId);

  if (!skill) {
    notFound();
  }

  return (
    <SkillPageContent
      skill={{
        source: skill.source,
        skillId: skill.skillId,
        name: skill.name,
        description: skill.description,
        installs: skill.installs,
        contentUpdatedAt: skill.contentUpdatedAt,
        createdAt: skill._creationTime,
        isDelisted: skill.isDelisted ?? false,
        hasContentFetchError: skill.hasContentFetchError ?? false,
      }}
      content={skill.content ?? null}
      skillMdUrl={skill.skillMdUrl ?? null}
    />
  );
}
