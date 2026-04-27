import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { fetchQuery } from "convex/nextjs";
import { cacheLife } from "next/cache";
import { HugeiconsIcon } from "@hugeicons/react";
import { GithubIcon } from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import { LabeledSection } from "@/components/labeled-section";
import { MarkdownContent } from "@/components/markdown-content";
import { CopyButton } from "@/components/ui/cubby-ui/copy-button/copy-button";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { highlightMarkdownCode } from "@/lib/highlight-markdown-code";
import { formatInstalls, timeAgo } from "@/lib/utils";

type Params = Promise<{ org: string; repo: string; skillId: string }>;

async function loadSkill(source: string, skillId: string) {
  "use cache";
  cacheLife("days");
  return fetchQuery(api.skills.getBySourceAndSkillId, { source, skillId });
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
  const { org, repo, skillId } = await params;
  const source = `${org}/${repo}`;
  const installCommand = `npx skills add ${source} --skill ${skillId}`;

  return (
    <div className="mx-auto max-w-5xl px-4 pt-12 pb-24">
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

      <h1 className="font-display text-3xl font-semibold tracking-tight text-balance mb-3">
        {skillId}
      </h1>

      <Suspense
        fallback={<SkillDetailSkeleton installCommand={installCommand} />}
      >
        <SkillDetailContent source={source} skillId={skillId} />
      </Suspense>
    </div>
  );
}

async function SkillDetailContent({
  source,
  skillId,
}: {
  source: string;
  skillId: string;
}) {
  const skill = await loadSkill(source, skillId);

  if (!skill) {
    notFound();
  }

  const installCommand = `npx skills add ${skill.source} --skill ${skill.skillId}`;
  const preHighlighted = skill.content
    ? await highlightMarkdownCode(skill.content)
    : undefined;

  return (
    <>
      {skill.isDelisted && (
        <div className="mb-4 rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-foreground">
          This skill is no longer listed on skills.sh
        </div>
      )}

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="tabular-nums">
          {formatInstalls(skill.installs)} installs
        </span>
        <span>·</span>
        <a
          href={`https://github.com/${skill.source}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors hover:underline"
        >
          <HugeiconsIcon
            icon={GithubIcon}
            strokeWidth={2}
            className="size-3.5"
          />
          {skill.source}
        </a>
        <span>·</span>
        {skill.contentUpdatedAt ? (
          <span>Updated {timeAgo(skill.contentUpdatedAt)}</span>
        ) : (
          <span>Added {timeAgo(skill._creationTime)}</span>
        )}
      </div>

      {skill.hasContentFetchError && !skill.isDelisted && (
        <div className="mt-6 rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-foreground">
          This skill&apos;s source file could not be found in its repository.
          The install command may not work.
        </div>
      )}

      <LabeledSection label="Install" className="mt-10">
        <div className="group relative rounded-xl bg-muted w-fit max-w-full">
          <pre className="overflow-x-auto px-4 py-3 text-sm font-mono pr-16">
            {installCommand}
          </pre>
          <div className="absolute top-1/2 right-1.5 -translate-y-1/2">
            <CopyButton content={installCommand} className="backdrop-blur-sm" />
          </div>
        </div>
      </LabeledSection>

      {skill.description && (
        <LabeledSection label="Overview" className="mt-10">
          <p className="text-lg leading-relaxed text-pretty text-muted-foreground">
            {skill.description}
          </p>
        </LabeledSection>
      )}

      {skill.content && (
        <LabeledSection label="Documentation" className="mt-14">
          <MarkdownContent
            preHighlighted={preHighlighted}
            baseUrl={skill.skillMdUrl ?? null}
          >
            {skill.content}
          </MarkdownContent>
        </LabeledSection>
      )}

      {!skill.description && !skill.content && (
        <p className="mt-10 text-sm text-muted-foreground">
          No documentation available for this skill.
        </p>
      )}
    </>
  );
}

function SkillDetailSkeleton({ installCommand }: { installCommand: string }) {
  return (
    <>
      <div className="flex items-center gap-2 text-sm">
        <Skeleton className="h-4 w-20" />
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        <Skeleton className="h-4 w-40" />
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        <Skeleton className="h-4 w-24" />
      </div>

      <LabeledSection label="Install" className="mt-10">
        <div className="rounded-xl bg-muted w-fit max-w-full">
          <pre className="overflow-x-auto px-4 py-3 text-sm font-mono pr-16 invisible">
            {installCommand}
          </pre>
        </div>
      </LabeledSection>

      <LabeledSection label="Overview" className="mt-10">
        <div className="space-y-2">
          <Skeleton className="h-5 w-full max-w-2xl" />
          <Skeleton className="h-5 w-full max-w-xl" />
          <Skeleton className="h-5 w-3/4 max-w-md" />
        </div>
      </LabeledSection>

      <LabeledSection label="Documentation" className="mt-14">
        <div className="space-y-3">
          <Skeleton className="h-6 w-64" />
          <div className="space-y-2 pt-2">
            <Skeleton className="h-4 w-full max-w-2xl" />
            <Skeleton className="h-4 w-full max-w-2xl" />
            <Skeleton className="h-4 w-2/3 max-w-md" />
          </div>
          <div className="space-y-2 pt-4">
            <Skeleton className="h-4 w-full max-w-2xl" />
            <Skeleton className="h-4 w-5/6 max-w-2xl" />
          </div>
        </div>
      </LabeledSection>
    </>
  );
}
