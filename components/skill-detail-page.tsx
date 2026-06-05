import "server-only";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { fetchQuery } from "convex/nextjs";
import { cacheLife } from "next/cache";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { api } from "@/convex/_generated/api";
import { LabeledSection } from "@/components/labeled-section";
import { MarkdownContent } from "@/components/markdown-content";
import { CopyButton } from "@/components/ui/cubby-ui/copy-button/copy-button";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { highlightMarkdownCode } from "@/lib/highlight-markdown-code";
import { formatInstalls, timeAgo } from "@/lib/utils";
import { OfficialBadge } from "@/components/skill-badges";
import { SkillAuditSection } from "@/components/skill-audit-section";

// Shared cached loaders. Both the `/[org]/[repo]/[skillId]` and the
// `/site/[source]/[skillId]` routes import these (also from generateMetadata),
// so the metadata pass and the body pass dedupe to a single cache entry per
// (source, skillId).
export async function loadSkill(source: string, skillId: string) {
  "use cache";
  cacheLife("days");
  return fetchQuery(api.skills.getBySourceAndSkillId, { source, skillId });
}

export async function loadAudits(source: string, skillId: string) {
  "use cache";
  cacheLife("days");
  const row = await fetchQuery(api.audits.getBySourceAndSkillId, {
    source,
    skillId,
  });
  return row?.audits ?? null;
}

// Shiki's highlighter calls `Date.now()` internally, which isn't permitted on
// the static prerender path under Cache Components. Wrapping the highlight in a
// cache boundary satisfies that constraint and content-addresses the result
// (keyed by the markdown), so unchanged content reuses the cached HTML.
async function loadHighlightedCode(content: string) {
  "use cache";
  cacheLife("days");
  return highlightMarkdownCode(content);
}

// `timeAgo` reads `Date.now()`, which isn't permitted on the static prerender
// path under Cache Components. Computing it inside a cache boundary is allowed;
// the relative label is then cached for ~a day (refreshed on revalidation),
// which is plenty fresh for an "Updated N days ago" string.
async function loadTimeAgo(timestamp: number) {
  "use cache";
  cacheLife("days");
  return timeAgo(timestamp);
}

type SkillDetailContentProps = {
  source: string;
  skillId: string;
  installCommand: string;
  externalUrl: string;
  externalIcon: IconSvgElement;
  externalLabel: string;
  /** Breadcrumb slot rendered above the h1. */
  breadcrumb: ReactNode;
};

/**
 * Static page shell. Everything here is param-independent, so Cache Components
 * prerenders it at build and serves it instantly for ANY skill URL — generated
 * or not, link-click or hard refresh. The param-dependent content (passed as
 * `children`) is read inside this Suspense boundary, so it streams in behind
 * the skeleton instead of blocking the initial response. After the first
 * render, `generateStaticParams` + ISR saves the resolved page, so repeat
 * visits get the finished HTML with no skeleton.
 */
export function SkillDetailShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl px-4 pt-12 pb-24">
      <Suspense fallback={<SkillDetailContentSkeleton />}>{children}</Suspense>
    </div>
  );
}

export async function SkillDetailContent({
  source,
  skillId,
  installCommand,
  externalUrl,
  externalIcon,
  externalLabel,
  breadcrumb,
}: SkillDetailContentProps) {
  const [skill, audits] = await Promise.all([
    loadSkill(source, skillId),
    loadAudits(source, skillId),
  ]);

  if (!skill) {
    notFound();
  }

  const preHighlighted = skill.content
    ? await loadHighlightedCode(skill.content)
    : undefined;

  const timeLabel = skill.contentUpdatedAt
    ? `Updated ${await loadTimeAgo(skill.contentUpdatedAt)}`
    : `Added ${await loadTimeAgo(skill._creationTime)}`;

  return (
    <>
      {breadcrumb}

      <h1 className="font-display text-3xl font-semibold tracking-tight text-balance mb-3">
        {skillId}
      </h1>

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

// Fallback for the Suspense boundary in `SkillDetailShell`. Stands in for the
// full param-dependent content — breadcrumb, title, and body — since all of it
// now resolves inside the boundary. This is what shows instantly on a first
// (uncached) visit while the page renders; once saved, repeat visits skip it.
function SkillDetailContentSkeleton() {
  return (
    <>
      <div className="mb-6">
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>

      <Skeleton className="mb-3 h-9 w-1/2 max-w-md" />

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
        <Skeleton className="h-11 w-72 max-w-full rounded-xl" />
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
