import "server-only";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { cacheLife, cacheTag } from "next/cache";
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
import { BundleToggleButton } from "@/components/bundle-toggle-button";
import { SkillCopies } from "@/components/skill-copies";
import { skillHref } from "@/lib/skill-urls";

// Shared loaders. `fetchQuery` forces `cache: "no-store"` on its underlying
// fetch, which would block prerendering. Each loader is a `'use cache'`
// function: that isolates the no-store fetch behind a cache boundary and keys
// the result by its args (source, skillId), so the route prerenders a static
// shell and the `generateMetadata` pass + body share one entry.
//
// The loaders carrying syncSkills-written data (install count + rank +
// snapshots) share the "skill-sync" `cacheTag`. The daily syncSkills cron pings
// that tag via /api/revalidate (see convex/skills.ts), so every skill page's
// number and chart refresh in lockstep with the sync instead of drifting up to
// a day on the cacheLife window alone. loadAudits/loadStars are updated by other
// processes, so they keep their own independent daily cadence and are untagged.
const SKILL_SYNC_TAG = "skill-sync";

export async function loadSkill(source: string, skillId: string) {
  "use cache";
  cacheLife("days");
  cacheTag(SKILL_SYNC_TAG);
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

// getInsights returns only daily-cadence fields (install count, installRank,
// snapshots — all written by the daily syncSkills cron). Tagged "skill-sync" so
// the sync refreshes it on demand; the 24h revalidate is the fallback if a ping
// is missed. The faster-moving momentum fields (trending/hot) deliberately stay
// off this page; they live on the home rails, kept fresh by their own crons.
export async function loadInsights(source: string, skillId: string) {
  "use cache";
  cacheLife("days");
  cacheTag(SKILL_SYNC_TAG);
  return fetchQuery(api.skills.getInsights, { source, skillId });
}

// Duplicate/rename relationships (Phase 2): the live skill a renamed alias
// points to, plus aliases (same repo, other names) and forks (different repos,
// same content). Populated by resolveRepoIdentities. Tagged "skill-sync" so it
// busts alongside the install data when a sync pings the revalidate route,
// rather than lagging the full 24h ISR window after relationships change.
export async function loadCopies(source: string, skillId: string) {
  "use cache";
  cacheLife("days");
  cacheTag(SKILL_SYNC_TAG);
  return fetchQuery(api.duplicates.getSkillCopies, { source, skillId });
}

// GitHub star count for the repo behind a skill. Fetched lazily (only for
// viewed skills) and cached 24h, so it piggybacks on the page's existing ISR
// regeneration rather than adding a daily sync over thousands of repos.
// GitHub sources only (source is "owner/repo"); well-known sources have no repo.
// Set GITHUB_TOKEN to lift GitHub's 60/hr unauthenticated limit to 5000/hr.
export async function loadStars(source: string): Promise<number | null> {
  "use cache";
  cacheLife("days");
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
}

// `timeAgo` reads `Date.now()`, which can't be baked into the prerender. The
// "updated X ago" label is coarse and rides this page's daily snapshot, so
// caching the formatted value on the same daily cadence as the rest of the page
// keeps the route prerenderable without shortening its revalidate window.
async function updatedAgoLabel(timestamp: number) {
  "use cache";
  cacheLife("days");
  return timeAgo(timestamp);
}

// shiki reads `Date.now()` internally, which can't be baked into a prerender.
// The highlight is deterministic and expensive, so caching it (keyed by content)
// freezes that read and keeps the skill body in the static shell.
async function highlightSkillContent(content: string) {
  "use cache";
  cacheLife("days");
  return highlightMarkdownCode(content);
}

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
  const [skill, audits, insights, stars, copies] = await Promise.all([
    loadSkill(source, skillId),
    loadAudits(source, skillId),
    loadInsights(source, skillId),
    loadStars(source),
    loadCopies(source, skillId),
  ]);

  if (!skill) {
    notFound();
  }

  const preHighlighted = skill.content
    ? await highlightSkillContent(skill.content)
    : undefined;

  const updatedKind = skill.contentUpdatedAt ? "Updated" : "Added";
  const updatedAgo = await updatedAgoLabel(
    skill.contentUpdatedAt ?? skill._creationTime,
  );

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

      {copies.renamedTo && (
        <div className="mb-4 rounded-lg border border-info-border bg-info px-4 py-3 text-sm text-info-foreground">
          This repository was renamed. Live version:{" "}
          <Link
            href={skillHref(copies.renamedTo.source, copies.renamedTo.skillId)}
            className="font-medium underline underline-offset-2 hover:no-underline"
          >
            {copies.renamedTo.source}/{copies.renamedTo.skillId}
          </Link>
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

        {/* Mobile-only: the page's primary action sits right under the install
            command, where the eye and thumb already are. On desktop the same
            action lives at the top of the sidebar (below), so this is hidden
            there to avoid duplicating it. */}
        <div className="mt-6 lg:hidden">
          <BundleToggleButton
            source={source}
            skillId={skillId}
            name={skill.name}
          />
        </div>

        {skill.description && (
          <LabeledSection label="Overview" className="mt-10 lg:col-start-1">
            <p className="text-lg leading-relaxed text-pretty text-muted-foreground">
              {skill.description}
            </p>
          </LabeledSection>
        )}

        <SkillCopies
          aliases={copies.aliases}
          forks={copies.forks}
          className="mt-10 lg:col-start-1"
        />

        {/* Spans all rows of column 2 (`grid-row: 1 / span 99`) so it never
            forces a column-1 row to its own height — placing it in just row 1
            would inflate the Install row to the sidebar's height. self-start +
            sticky keep it pinned at the top while the docs scroll. */}
        <aside className="mt-10 lg:col-start-2 lg:mt-0 lg:self-start lg:sticky lg:top-20 lg:row-[1/span_99]">
          {/* Desktop sidebar primary action. On mobile this is hidden and the
              same button renders under the install command instead. */}
          <div className="mb-6 hidden lg:block">
            <BundleToggleButton
              source={source}
              skillId={skillId}
              name={skill.name}
            />
          </div>
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
