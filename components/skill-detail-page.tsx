import "server-only";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { unstable_cache } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { GitCompareIcon } from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import { LabeledSection } from "@/components/labeled-section";
import { MarkdownContent } from "@/components/markdown-content";
import { Button } from "@/components/ui/cubby-ui/button";
import { CopyButton } from "@/components/ui/cubby-ui/copy-button/copy-button";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { highlightMarkdownCode } from "@/lib/highlight-markdown-code";
import { compareHref } from "@/lib/compare";
import { timeAgo } from "@/lib/utils";
import { SkillSidebar } from "@/components/skill-sidebar";

// Shared loaders. `fetchQuery` forces `cache: "no-store"` on its underlying
// fetch, which would mark the route dynamic and break static/ISR generation.
// Wrapping in `unstable_cache` isolates that fetch and caches the result by
// (source, skillId) — the args are part of the cache key — so the route can be
// statically generated and the `generateMetadata` pass + body share one entry.
export const loadSkill = unstable_cache(
  (source: string, skillId: string) =>
    fetchQuery(api.skills.getBySourceAndSkillId, { source, skillId }),
  ["skill-detail"],
  { revalidate: 86400 },
);

export const loadAudits = unstable_cache(
  async (source: string, skillId: string) => {
    const row = await fetchQuery(api.audits.getBySourceAndSkillId, {
      source,
      skillId,
    });
    return row?.audits ?? null;
  },
  ["skill-audits"],
  { revalidate: 86400 },
);

// Cached 24h to match the page's ISR cadence. getInsights returns only daily-
// cadence fields (install count, installRank, snapshots — all written by the
// daily syncSkills cron), so this cache is never out of step with its source.
// The faster-moving momentum fields (trending/hot) deliberately stay off this
// page; they live on the home rails, kept fresh by their own crons.
export const loadInsights = unstable_cache(
  (source: string, skillId: string) =>
    fetchQuery(api.skills.getInsights, { source, skillId }),
  ["skill-insights"],
  { revalidate: 86400 },
);

// GitHub star count for the repo behind a skill. Fetched lazily (only for
// viewed skills) and cached 24h, so it piggybacks on the page's existing ISR
// regeneration rather than adding a daily sync over thousands of repos.
// GitHub sources only (source is "owner/repo"); well-known sources have no repo.
// Set GITHUB_TOKEN to lift GitHub's 60/hr unauthenticated limit to 5000/hr.
export const loadStars = unstable_cache(
  async (source: string): Promise<number | null> => {
    if (!source.includes("/")) return null;
    try {
      const res = await fetch(`https://api.github.com/repos/${source}`, {
        headers: {
          Accept: "application/vnd.github+json",
          ...(process.env.GITHUB_TOKEN
            ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
            : {}),
        },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { stargazers_count?: unknown };
      return typeof data.stargazers_count === "number"
        ? data.stargazers_count
        : null;
    } catch {
      return null;
    }
  },
  ["skill-stars"],
  { revalidate: 86400 },
);

type SkillDetailPageProps = {
  source: string;
  skillId: string;
  installCommand: string;
  externalUrl: string;
  externalIcon: IconSvgElement;
  externalLabel: string;
  /** Breadcrumb slot rendered above the h1. */
  breadcrumb: ReactNode;
};

export function SkillDetailPage({
  source,
  skillId,
  installCommand,
  externalUrl,
  externalIcon,
  externalLabel,
  breadcrumb,
}: SkillDetailPageProps) {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-12 pb-24">
      {breadcrumb}

      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <h1 className="font-display min-w-0 text-3xl font-medium tracking-tight text-balance">
          {skillId}
        </h1>
        <Button
          nativeButton={false}
          variant="outline"
          size="sm"
          className="shrink-0"
          render={<Link href={compareHref([{ source, skillId }])} />}
          leftSection={
            <HugeiconsIcon
              icon={GitCompareIcon}
              strokeWidth={2}
              className="size-3.5"
            />
          }
        >
          Compare
        </Button>
      </div>

      <Suspense
        fallback={<SkillDetailPageSkeleton installCommand={installCommand} />}
      >
        <SkillDetailBody
          source={source}
          skillId={skillId}
          installCommand={installCommand}
          externalUrl={externalUrl}
          externalIcon={externalIcon}
          externalLabel={externalLabel}
        />
      </Suspense>
    </div>
  );
}

async function SkillDetailBody({
  source,
  skillId,
  installCommand,
  externalUrl,
  externalIcon,
  externalLabel,
}: {
  source: string;
  skillId: string;
  installCommand: string;
  externalUrl: string;
  externalIcon: IconSvgElement;
  externalLabel: string;
}) {
  const [skill, audits, insights, stars] = await Promise.all([
    loadSkill(source, skillId),
    loadAudits(source, skillId),
    loadInsights(source, skillId),
    loadStars(source),
  ]);

  if (!skill) {
    notFound();
  }

  const preHighlighted = skill.content
    ? await highlightMarkdownCode(skill.content)
    : undefined;

  const updatedKind = skill.contentUpdatedAt ? "Updated" : "Added";
  const updatedAgo = timeAgo(skill.contentUpdatedAt ?? skill._creationTime);

  return (
    <>
      {skill.isDelisted && (
        <div className="mb-4 rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-foreground">
          This skill is no longer listed on skills.sh
        </div>
      )}

      {skill.hasContentFetchError && !skill.isDelisted && (
        <div className="mb-4 rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-foreground">
          This skill&apos;s source file could not be loaded. The install command
          may not work.
        </div>
      )}

      {/* Two-column on desktop: the skill's own content (install, overview,
          docs) in column 1, supplemental facts in a sticky sidebar in column 2.
          DOM order is install → overview → sidebar → docs, so on mobile (grid
          off) the sidebar stacks *above* the long doc rather than at the very
          bottom. */}
      <div className="mt-8 lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start lg:gap-x-12">
        <LabeledSection label="Install" className="lg:col-start-1">
          <div className="group relative w-fit max-w-full rounded-xl bg-muted">
            <pre className="overflow-x-auto px-4 py-3 pr-16 font-mono text-sm">
              {installCommand}
            </pre>
            <div className="absolute top-1/2 right-1.5 -translate-y-1/2">
              <CopyButton
                content={installCommand}
                className="backdrop-blur-sm"
              />
            </div>
          </div>
        </LabeledSection>

        {skill.description && (
          <LabeledSection label="Overview" className="mt-10 lg:col-start-1">
            <p className="text-lg leading-relaxed text-pretty text-muted-foreground">
              {skill.description}
            </p>
          </LabeledSection>
        )}

        {/* Spans all rows of column 2 (`grid-row: 1 / span 99`) so it never
            forces a column-1 row to its own height — placing it in just row 1
            would inflate the Install row to the sidebar's height. self-start +
            sticky keep it pinned at the top while the docs scroll. */}
        <aside className="mt-10 lg:col-start-2 lg:mt-0 lg:self-start lg:sticky lg:top-20 lg:row-[1/span_99]">
          <SkillSidebar
            source={source}
            skillId={skillId}
            externalUrl={externalUrl}
            externalIcon={externalIcon}
            externalLabel={externalLabel}
            curatedOwner={skill.curatedOwner}
            installs={skill.installs}
            insights={insights}
            updatedKind={updatedKind}
            updatedAgo={updatedAgo}
            audits={audits}
            stars={stars}
          />
        </aside>

        {skill.content && (
          <LabeledSection
            label="Documentation"
            className="mt-12 lg:col-start-1 lg:mt-14"
          >
            <MarkdownContent
              preHighlighted={preHighlighted}
              baseUrl={skill.skillMdUrl ?? null}
            >
              {skill.content}
            </MarkdownContent>
          </LabeledSection>
        )}

        {!skill.description && !skill.content && (
          <p className="mt-10 text-sm text-muted-foreground lg:col-start-1">
            No documentation available for this skill.
          </p>
        )}
      </div>
    </>
  );
}

export function SkillDetailPageSkeleton({
  installCommand,
}: {
  installCommand: string;
}) {
  return (
    <div className="mt-8 lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start lg:gap-x-12">
      <LabeledSection label="Install" className="lg:col-start-1">
        <div className="w-fit max-w-full rounded-xl bg-muted">
          <pre className="invisible overflow-x-auto px-4 py-3 pr-16 font-mono text-sm">
            {installCommand}
          </pre>
        </div>
      </LabeledSection>

      <LabeledSection label="Overview" className="mt-10 lg:col-start-1">
        <div className="space-y-2">
          <Skeleton className="h-5 w-full max-w-2xl" />
          <Skeleton className="h-5 w-full max-w-xl" />
          <Skeleton className="h-5 w-3/4 max-w-md" />
        </div>
      </LabeledSection>

      <div className="mt-10 flex flex-col gap-7 lg:col-start-2 lg:mt-0 lg:row-[1/span_99] lg:self-start">
        <div>
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-2.5 h-7 w-24" />
          <Skeleton className="mt-3 h-9 w-full rounded-lg" />
        </div>
        <div>
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-2.5 h-4 w-32" />
        </div>
        <div>
          <Skeleton className="h-3 w-16" />
          <div className="mt-2.5 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
      </div>

      <LabeledSection
        label="Documentation"
        className="mt-12 lg:col-start-1 lg:mt-14"
      >
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
    </div>
  );
}

// Route-level fallback for each skill route's `loading.tsx`. The router shows
// this instantly while a not-yet-generated skill is rendered on-demand; once
// ISR caches the page, repeat visits serve the finished HTML and never hit this.
export function SkillDetailPageLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-12 pb-24">
      <div className="mb-6">
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>

      <Skeleton className="mb-3 h-9 w-1/2 max-w-md" />

      <SkillDetailPageSkeleton installCommand="npx skills add ..." />
    </div>
  );
}
