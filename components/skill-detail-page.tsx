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
import { formatDate } from "@/lib/utils";
import { SkillSidebar } from "@/components/skill-sidebar";
import { BundleToggleButton } from "@/components/bundle-toggle-button";
import { SkillCopies } from "@/components/skill-copies";
import { SkillHistory } from "@/components/skill-history";
import { skillHref } from "@/lib/skill-urls";
import { DataErrorBoundary } from "@/components/data-error-boundary";
import { loadSkill, SKILL_SYNC_TAG } from "@/lib/skill-cache";

// Shared loaders. `fetchQuery` forces `cache: "no-store"` on its underlying
// fetch, which would block prerendering. Each loader is a `'use cache'`
// function: that isolates the no-store fetch behind a cache boundary and keys
// the result by its args (source, skillId), so the route prerenders a static
// shell and the `generateMetadata` pass + body share one entry.
//
// The skill row itself is loaded by `loadSkill` in lib/skill-cache.ts, which
// also carries the canonical explanation of the two-tag split ("skill-sync" for
// daily install data, "skill-content" for the row). Read that before re-tagging
// or merging anything below.
//
// loadAudits and loadStars stay untagged, for two different reasons: the audit chain writes audits but pinging for them does not
// pay (see below), and nothing in this app writes star counts at all — that
// loader calls GitHub directly, so a tag would have no publisher.
//
// loadAudits deliberately stays on "days" and untagged. A weekly life plus a
// dedicated "skill-audit" tag was tried and reverted: that tag's publish gate is
// a catalog-wide OR over the whole day's audit drain (~1.3k skills), and
// `auditsChanged` counts a provider re-stamping `auditedAt` under an identical
// verdict — so the gate fires most days and the entry gets expired daily anyway,
// exactly as this timer does. It bought no writes while replacing a guaranteed
// 24h self-heal with a best-effort ping whose only signal lived in scheduler
// args, and moving `expire` from 7 days to 30 on a security surface. Revisit
// only alongside per-skill tags (TODO.md), which is what would make such a gate
// selective enough to pay.

export async function loadAudits(source: string, skillId: string) {
  "use cache";
  cacheLife("days");
  const row = await fetchQuery(api.audits.getBySourceAndSkillId, {
    source,
    skillId,
  });
  return row?.audits ?? null;
}

// Everything on the "skill-sync" cadence, in ONE cache entry:
//
//   insights — install count, installRank, snapshots (daily syncSkills). The
//              faster-moving momentum fields (trending/hot) deliberately stay
//              off this page; they live on the home rails, kept fresh by their
//              own crons.
//   copies   — duplicate/rename relationships: the live skill a renamed alias
//              points to, plus aliases (same repo, other names) and forks
//              (different repos, same content). Populated by
//              resolveRepoIdentities on the weekly duplicate chain.
//   versions — version history for the History section, written on the
//              content-refresh path.
//
// These were three separate `'use cache'` functions. They bought nothing:
// SkillDetailBody awaits all of them in a single Promise.all inside a single
// Suspense boundary, so there was never any independent streaming to gain, and
// they share one tag so they were always invalidated together anyway. Three
// entries meant three ISR writes per post-sync visit for one boundary's worth
// of data. Only split them again if one of them moves behind its own Suspense
// boundary or onto a different tag.
//
// The 24h cacheLife is the fallback if a revalidate ping is missed.
export async function loadSkillSyncData(source: string, skillId: string) {
  "use cache";
  cacheLife("days");
  cacheTag(SKILL_SYNC_TAG);
  const [insights, copies, versions] = await Promise.all([
    fetchQuery(api.skills.getInsights, { source, skillId }),
    fetchQuery(api.duplicates.getSkillCopies, { source, skillId }),
    fetchQuery(api.skillVersions.listForSkill, { source, skillId }),
  ]);
  return { insights, copies, versions };
}

// GitHub star count for the repo behind a skill. Fetched lazily (only for
// viewed skills) rather than by a sync over thousands of repos.
// GitHub sources only (source is "owner/repo"); well-known sources have no repo.
// Set GITHUB_TOKEN to lift GitHub's 60/hr unauthenticated limit to 5000/hr.
//
// Untagged, so the cacheLife below is the whole mechanism — nothing in this
// system writes star counts; the loader calls GitHub directly. Keyed by
// `source`, not by skill, so every skill in a repo shares one entry.
//
// THREE different lifetimes, because `'use cache'` persists a failure exactly
// like a success and this loader has three outcomes that mean different things:
//
//   no repo   — a well-known source has no GitHub repo, ever. Structural, so
//               "max" (30d revalidate / 365d expire) rather than re-deciding
//               it on a timer.
//   a count   — "weeks" (7d revalidate / 30d expire), so a star count can read
//               up to 30 days stale in the tail. Fine: it is decorative and
//               drifts slowly, and each refresh is a live GitHub call, so
//               stretching it cuts rate-limit pressure as much as cache writes.
//   a failure — a 403 from the 60/hr unauthenticated ceiling (GITHUB_TOKEN is
//               optional, so that is a supported setup), a 5xx, a dropped
//               socket, or a malformed body. Must NOT inherit the long life:
//               `null` hides the whole Stars section, the entry is keyed by
//               repo so one 403 would blank it for every skill in that repo,
//               and nothing can revalidate an untagged entry before a new
//               build.
//
//               "hours" (1h revalidate / 24h expire), NOT "minutes". The
//               dominant failure above is the hourly rate limit, and a 60s
//               retry would re-request each viewed repo ~60 times per hour
//               while the limit is tripped — contradicting the very argument
//               made for the long life one line up. An hour matches the reset
//               window and still recovers ~168x faster than "weeks". The cost
//               is that a transient blip also hides the section for up to an
//               hour, which for a decorative number is the better trade.
//
// Conditional cacheLife across branches is the documented pattern for exactly
// this ("cache briefly when an item is missing but likely available later").
export async function loadStars(source: string): Promise<number | null> {
  "use cache";
  if (!source.includes("/")) {
    cacheLife("max");
    return null;
  }
  try {
    // What actually keeps this on the /repos endpoint is `SAFE_SEGMENT` in
    // lib/install-commands.ts rejecting exact dot segments — the route only
    // renders once `buildSkillInstallCommand` returns non-null, which runs that
    // check. encodeURIComponent is belt-and-braces for the rest of the charset
    // and does NOT cover the dot case: `.` is unreserved, so it re-emits ".."
    // unchanged and `/repos/../x` would still collapse onto `/x`, with the
    // token attached. Do not treat this line as the guard.
    const path = source.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(`https://api.github.com/repos/${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
    });
    if (!res.ok) {
      cacheLife("hours");
      return null;
    }
    const data = (await res.json()) as { stargazers_count?: unknown };
    if (typeof data.stargazers_count !== "number") {
      cacheLife("hours");
      return null;
    }
    cacheLife("weeks");
    return data.stargazers_count;
  } catch {
    cacheLife("hours");
    return null;
  }
}

// shiki reads `Date.now()` internally, which can't be baked into a prerender.
// The highlight is deterministic and expensive, so caching it (keyed by content)
// freezes that read and keeps the skill body in the static shell.
//
// "max", not "days": the cache key IS the content and the transform is pure, so
// re-running on a timer can only ever reproduce the same bytes. On "days" that
// meant re-running shiki and rewriting an identical entry every 24h for every
// viewed skill; "max" stretches that to a 30-day revalidate (365-day expire).
// Not "never" — no `'use cache'` profile is, and entries are keyed by build ID
// anyway, so every deploy resets them. On a frequently-deployed app the real
// ceiling here is deploy cadence, not cacheLife.
//
// The content-keying also means aliases and forks (which this app explicitly
// tracks, see loadSkillSyncData) share a single entry rather than one each.
async function highlightSkillContent(content: string) {
  "use cache";
  cacheLife("max");
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
          leadingIcon={
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

      {/* Boundary sits around the Suspense, not inside it, so it covers the
          fallback too. The breadcrumb, h1 and Compare action above stay
          rendered if the body fails — the page remains navigable. */}
      <DataErrorBoundary label="this skill">
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
      </DataErrorBoundary>
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
  const [skill, audits, syncData, stars] = await Promise.all([
    loadSkill(source, skillId),
    loadAudits(source, skillId),
    loadSkillSyncData(source, skillId),
    loadStars(source),
  ]);

  if (!skill) {
    notFound();
  }

  const { insights, copies, versions } = syncData;

  const preHighlighted = skill.content
    ? await highlightSkillContent(skill.content)
    : undefined;

  const updatedKind = skill.contentUpdatedAt ? "Updated" : "Added";
  const updatedDate = formatDate(skill.contentUpdatedAt ?? skill._creationTime);

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

      {skill.isGitHubOnly && !skill.isDelisted && (
        <div className="mb-4 rounded-lg border border-info-border bg-info px-4 py-3 text-sm text-info-foreground">
          This skill is available only on GitHub, not through the skills.sh API.
          Install counts and security audits stay unavailable until it&apos;s
          listed on skills.sh.
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

        {/* Above Documentation, not below it. A SKILL.md runs to tens of KB, so
            anything after it is effectively unreachable without deliberate
            scrolling — and "has this changed recently?" is a question people
            have BEFORE committing to reading the docs, not after. Collapsed it
            is only a few rows, so it costs the reader almost nothing on the way
            past. Sits with the other supplemental sections rather than
            interrupting the Overview → Documentation run. */}
        <SkillHistory versions={versions} className="mt-10 lg:col-start-1" />

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
            insights={insights}
            updatedKind={updatedKind}
            updatedDate={updatedDate}
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
