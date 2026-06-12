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
import { formatInstalls, timeAgo } from "@/lib/utils";
import { OfficialBadge } from "@/components/skill-badges";
import { SkillAuditSection } from "@/components/skill-audit-section";

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
    <div className="mx-auto max-w-5xl px-4 pt-12 pb-24">
      {breadcrumb}

      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <h1 className="font-display min-w-0 text-3xl font-semibold tracking-tight text-balance">
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
  const [skill, audits] = await Promise.all([
    loadSkill(source, skillId),
    loadAudits(source, skillId),
  ]);

  if (!skill) {
    notFound();
  }

  const preHighlighted = skill.content
    ? await highlightMarkdownCode(skill.content)
    : undefined;

  const timeLabel = skill.contentUpdatedAt
    ? `Updated ${timeAgo(skill.contentUpdatedAt)}`
    : `Added ${timeAgo(skill._creationTime)}`;

  return (
    <>
      {skill.isDelisted && (
        <div className="mb-4 rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-foreground">
          This skill is no longer listed on skills.sh
        </div>
      )}

      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        {skill.curatedOwner && <OfficialBadge owner={skill.curatedOwner} />}
        <span className="tabular-nums">
          {formatInstalls(skill.installs)} installs
        </span>
        <span>·</span>
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors hover:underline"
        >
          <HugeiconsIcon
            icon={externalIcon}
            strokeWidth={2}
            className="size-3.5"
          />
          {externalLabel}
        </a>
        <span>·</span>
        <span>{timeLabel}</span>
      </div>

      {skill.hasContentFetchError && !skill.isDelisted && (
        <div className="mt-6 rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-foreground">
          This skill&apos;s source file could not be loaded. The install command
          may not work.
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

      <SkillAuditSection
        source={source}
        skillId={skillId}
        audits={audits}
        className="mt-10"
      />

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

export function SkillDetailPageSkeleton({
  installCommand,
}: {
  installCommand: string;
}) {
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

// Route-level fallback for each skill route's `loading.tsx`. The router shows
// this instantly while a not-yet-generated skill is rendered on-demand; once
// ISR caches the page, repeat visits serve the finished HTML and never hit this.
export function SkillDetailPageLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 pt-12 pb-24">
      <div className="mb-6">
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>

      <Skeleton className="mb-3 h-9 w-1/2 max-w-md" />

      <SkillDetailPageSkeleton installCommand="npx skills add ..." />
    </div>
  );
}
