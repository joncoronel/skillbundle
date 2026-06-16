"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useQueryState } from "nuqs";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  Link04Icon,
  PencilEdit02Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import { LabeledSection } from "@/components/labeled-section";
import { MarkdownContent } from "@/components/markdown-content";
import { OfficialBadge } from "@/components/skill-badges";
import { AuditBadge } from "@/components/skill-audit-section";
import {
  CompareTrendChart,
  CompareTrendSkeleton,
  COMPARE_LINE_COLORS,
  type CompareSeries,
} from "@/components/skill-install-chart";
import { Button } from "@/components/ui/cubby-ui/button";
import { DotMatrix } from "@/components/ui/dot-matrix";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import type { PickerSkill } from "@/components/skill-picker";
import { useCopyToClipboard } from "@/components/ui/cubby-ui/copy-button/hooks/use-copy-to-clipboard";
import { formatInstalls } from "@/lib/utils";
import { compareSkillsParser } from "@/lib/search-params";
import {
  MAX_COMPARE_SKILLS,
  compareHref,
  refKey,
  type SkillRef,
} from "@/lib/compare";
import { BundleToggleButton } from "./bundle-toggle-button";
import {
  ComparePickerEmptyTrigger,
  ComparePickerRailTrigger,
  ComparePickerSheet,
} from "./compare-picker";
import { Crossfade } from "@/components/ui/cubby-ui/crossfade";

export function CompareContent() {
  const [refs, setRefs] = useQueryState("skills", compareSkillsParser);
  // The sheet lives here, above the empty-state/grid branch, so it stays open
  // across the first add (when EmptyState unmounts) and at-cap (when the rail
  // trigger unmounts).
  const [pickerOpen, setPickerOpen] = useState(false);
  const openPicker = () => setPickerOpen(true);

  // Note: on hard loads, Next's hydration canonicalizes the address bar via
  // URLSearchParams serialization, percent-encoding `/ : ,` into soup until
  // the next in-page nuqs update rewrites it. A one-time mount
  // history.replaceState with the readable form was tried and measurably
  // LOSES the race (the router's canonicalization runs later and overwrites
  // it), so we don't fight it — the Copy link button below guarantees pretty
  // shared links instead.
  // Defense-in-depth, mirroring toggleSkillAtom in lib/bundle-selection: the
  // picker disables Add at cap and for already-added skills, but the
  // invariant holds even if a future trigger forgets. A duplicate would also
  // render columns with duplicate React keys.
  const addSkill = (skill: PickerSkill) => {
    if (refs.length >= MAX_COMPARE_SKILLS) return;
    const exists = refs.some(
      (r) => r.source === skill.source && r.skillId === skill.skillId,
    );
    if (exists) return;
    setRefs([...refs, { source: skill.source, skillId: skill.skillId }]);
  };
  const removeSkill = (source: string, skillId: string) => {
    const next = refs.filter(
      (r) => !(r.source === source && r.skillId === skillId),
    );
    // null clears the param entirely so an emptied comparison is /compare,
    // not /compare?skills=
    setRefs(next.length > 0 ? next : null);
  };

  // One batched read for the whole comparison: every column's all-time rank and
  // daily snapshot series in a single query, so the combined chart and the
  // per-column rank stat share it (no per-column insights fetch). Keyed by the
  // refs array, so adding/removing a column refetches and React Query caches it.
  const { data: insightsData, isPending: insightsPending } = useQuery({
    ...convexQuery(api.skills.getCompareInsights, { refs }),
    staleTime: 5 * 60_000,
  });
  const insightFor = (ref: SkillRef) =>
    insightsData?.skills.find(
      (s) => s.source === ref.source && s.skillId === ref.skillId,
    );

  // One line per compared skill, colored by column position so the chart line,
  // the legend swatch, and the column header dot all share a hue.
  const series: CompareSeries[] = refs.map((ref, i) => {
    const entry = insightFor(ref);
    return {
      key: `s${i}`,
      name: entry?.name ?? ref.skillId,
      color: COMPARE_LINE_COLORS[i] ?? COMPARE_LINE_COLORS[0],
      snapshots: entry?.snapshots ?? [],
    };
  });

  return (
    <>
      {refs.length === 0 ? (
        <EmptyState onOpenPicker={openPicker} />
      ) : (
        <>
          <div className="mb-4 flex min-h-7 flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-eyebrow font-medium uppercase tracking-eyebrow text-muted-foreground">
              <span className="tabular-nums">
                {refs.length} / {MAX_COMPARE_SKILLS}
              </span>{" "}
              skills
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="xs"
                onClick={openPicker}
                leftSection={
                  <HugeiconsIcon
                    icon={PencilEdit02Icon}
                    strokeWidth={2}
                    className="size-3.5"
                  />
                }
              >
                Edit skills
              </Button>
              <CopyComparisonLink refs={refs} />
            </div>
          </div>
          <CompareTrendSection series={series} loading={insightsPending} />
          <CompareGrid refs={refs} onOpenPicker={openPicker}>
            {refs.map((ref, i) => {
              const entry = insightFor(ref);
              return (
                <CompareColumn
                  key={refKey(ref)}
                  source={ref.source}
                  skillId={ref.skillId}
                  accent={COMPARE_LINE_COLORS[i] ?? COMPARE_LINE_COLORS[0]}
                  rank={entry?.installRank ?? null}
                  rankLoading={insightsPending}
                  // A lone column has nothing left to compare against, so removal
                  // stops making sense below two.
                  onRemove={
                    refs.length >= 2
                      ? () => removeSkill(ref.source, ref.skillId)
                      : undefined
                  }
                />
              );
            })}
          </CompareGrid>
        </>
      )}
      <ComparePickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        refs={refs}
        onAdd={addSkill}
        onRemove={removeSkill}
      />
    </>
  );
}

/**
 * Copies an absolute link to the current comparison, always in the readable
 * serialized form (compareHref) — guaranteed pretty regardless of what the
 * address bar shows after Next's hydration canonicalization.
 */
function CopyComparisonLink({ refs }: { refs: SkillRef[] }) {
  // House clipboard hook (same one CopyButton uses): handles the timed
  // revert with unmount cleanup, reports failure instead of throwing, and
  // falls back to execCommand where the Clipboard API is denied.
  const { isCopied, copyToClipboard } = useCopyToClipboard();

  return (
    <Button
      variant="outline"
      size="xs"
      onClick={() =>
        copyToClipboard(window.location.origin + compareHref(refs))
      }
      leftSection={
        <HugeiconsIcon
          icon={isCopied ? Tick02Icon : Link04Icon}
          strokeWidth={2}
          className="size-3.5"
        />
      }
    >
      {isCopied ? "Copied" : "Copy link"}
    </Button>
  );
}

function EmptyState({ onOpenPicker }: { onOpenPicker: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-muted/40">
      <DotMatrix />
      <div className="relative px-6 py-16 md:px-12 md:py-24">
        <h2 className="font-display text-4xl font-medium tracking-tight leading-hero text-balance md:text-5xl">
          Nothing to compare yet.
        </h2>
        <p className="mt-4 max-w-md text-sm text-muted-foreground">
          Pick two or three skills to read their docs and stats side by side,
          then send the winner straight to your bundle.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <ComparePickerEmptyTrigger onClick={onOpenPicker} />
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link href="/" />}
          >
            Browse skills
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Shared column layout. Mobile: horizontal scroll-snap columns (one DOM
 * render — no duplicated tabs markup). md+: equal-width grid columns, plus a
 * slim add-column rail until the comparison is at capacity.
 */
function CompareGrid({
  refs,
  onOpenPicker,
  children,
}: {
  refs: SkillRef[];
  onOpenPicker: () => void;
  children: ReactNode;
}) {
  const withRail = refs.length < MAX_COMPARE_SKILLS;
  return (
    <div
      className={
        // Edge padding = (100vw − column width) / 2, so the first and last
        // columns have room to reach the centerline — snap-center can't
        // scroll past the content edges, so without this only middle columns
        // actually center.
        "-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-[7vw] pb-4 sm:px-[15vw] md:mx-0 md:grid md:gap-6 md:overflow-visible md:px-0 md:pb-0 " +
        (withRail
          ? "md:grid-cols-[repeat(var(--compare-cols),minmax(0,1fr))_4rem]"
          : "md:grid-cols-[repeat(var(--compare-cols),minmax(0,1fr))]")
      }
      style={{ "--compare-cols": refs.length } as CSSProperties}
    >
      {children}
      {withRail && <ComparePickerRailTrigger onClick={onOpenPicker} />}
    </div>
  );
}

/**
 * The single combined install chart sitting above the columns: one line per
 * compared skill, so trajectory reads across all of them at once instead of in
 * separate per-column sparklines. The column header dots map each skill to its
 * line. While the batched insights load it holds the chart's height with a
 * skeleton so the columns below don't jump.
 */
function CompareTrendSection({
  series,
  loading,
}: {
  series: CompareSeries[];
  loading: boolean;
}) {
  return (
    <section className="mb-4 rounded-2xl border bg-card p-5 dark:border-border/50 md:mb-6">
      <h2 className="mb-4 font-mono text-eyebrow font-medium uppercase tracking-eyebrow text-muted-foreground">
        Installs over time
      </h2>
      <Crossfade active={!loading}>
        <CompareTrendSkeleton />
        <CompareTrendChart series={series} />
      </Crossfade>
    </section>
  );
}

/**
 * One stat strip cell: tiny mono label over a value. The strip rows align
 * across columns because every shell renders the same strip at the same
 * position, which is what makes the columns comparable at a glance.
 */
function StatCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <dt className="font-mono text-label font-medium uppercase tracking-eyebrow text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 flex h-5 min-w-0 items-center gap-1.5 text-sm font-medium">
        {children}
      </dd>
    </div>
  );
}

/** Faint em-dash placeholder for a stat with no value. */
function StatDash() {
  return (
    <span aria-hidden="true" className="text-muted-foreground">
      —
    </span>
  );
}

/**
 * One compare column at its final dimensions: a single card holding the
 * title band, an aligned two-cell stat strip, a fixed-height scrollable doc
 * area, and the action row. Pending, not-found, and loaded states render the
 * same shell so data arriving causes no layout shift.
 */
function ColumnShell({
  title,
  titleHref,
  subtitle,
  accent,
  stats,
  onRemove,
  removeLabel,
  body,
  footer,
}: {
  title: string;
  titleHref?: string;
  subtitle?: ReactNode;
  /** Series color tying this column to its line in the combined chart above. */
  accent?: string;
  stats: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
  body: ReactNode;
  footer: ReactNode;
}) {
  return (
    // vw (not %) so the width pairs with the scroll container's vw edge
    // padding — percentages would resolve against the padded content box
    // and break the centering math.
    <article className="flex w-[86vw] shrink-0 snap-center flex-col sm:w-[70vw] md:w-auto md:shrink">
      <div className="flex flex-col overflow-hidden rounded-2xl border bg-card dark:border-border/50">
        <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0">
            <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold">
              {accent && (
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-[3px]"
                  style={{ background: accent }}
                />
              )}
              <span className="truncate">
                {titleHref ? (
                  <Link href={titleHref} className="hover:underline">
                    {title}
                  </Link>
                ) : (
                  title
                )}
              </span>
            </h2>
            {subtitle && (
              <div className="mt-0.5 min-w-0 text-xs text-muted-foreground">
                {subtitle}
              </div>
            )}
          </div>
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              aria-label={removeLabel}
              className="mt-0.5 shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring/50 focus-visible:outline-offset-2"
            >
              <HugeiconsIcon
                icon={Cancel01Icon}
                strokeWidth={2}
                className="size-3.5"
              />
            </button>
          )}
        </header>

        <dl className="grid grid-cols-3 divide-x divide-border/60 border-y border-border/60 dark:divide-border/40 dark:border-border/40">
          {stats}
        </dl>

        <div className="relative">
          <div className="h-[min(60vh,44rem)] overflow-y-auto overscroll-contain p-5">
            {body}
          </div>
          {/* Scroll affordance: long docs fade out instead of clipping flat
              against the action row. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-card"
          />
        </div>

        {footer && (
          <div className="border-t border-border/60 p-3 dark:border-border/40">
            {footer}
          </div>
        )}
      </div>
    </article>
  );
}

function CompareColumn({
  source,
  skillId,
  accent,
  rank,
  rankLoading,
  onRemove,
}: {
  source: string;
  skillId: string;
  /** Series color, matched to this skill's line in the chart above. */
  accent: string;
  /** All-time install rank from the batched insights query (null if unranked). */
  rank: number | null;
  rankLoading: boolean;
  onRemove?: () => void;
}) {
  // One query per column — the skills row carries everything including the
  // SKILL.md content. React Query caches it for the session, so re-adding a
  // column or revisiting the page in-session doesn't refetch. (Rank + the trend
  // come from the parent's single batched `getCompareInsights`, not per-column.)
  //
  // This hits Convex directly (one call per skill per visitor). If Convex
  // call volume or egress ever becomes a real cost, the escape hatch is a
  // GET route handler wrapping the already-cached `loadSkill` from
  // components/skill-detail-page.tsx (+ s-maxage for CDN hits) and pointing
  // this queryFn (and the skill detail sheet's) at it — restoring cross-user
  // caching without changing the page architecture. Deliberately NOT built
  // today: on Vercel Hobby + Convex Pro, that trades calls against the plan
  // with 25M/month headroom for invocations against capped free allotments,
  // and cache misses add a hop vs the already-open Convex websocket. Revisit
  // only on Vercel Pro + visible Convex costs.
  const { data: skill, isPending } = useQuery({
    ...convexQuery(api.skills.getBySourceAndSkillId, { source, skillId }),
    staleTime: 5 * 60_000,
  });

  const removeProps = onRemove
    ? { onRemove, removeLabel: `Remove ${skillId} from comparison` }
    : {};

  if (isPending) {
    return (
      <ColumnShell
        title={skillId}
        subtitle={<span className="block truncate">{source}</span>}
        accent={accent}
        stats={
          <>
            <StatCell label="Installs">
              <Skeleton className="h-4 w-12" />
            </StatCell>
            <StatCell label="Rank">
              <Skeleton className="h-4 w-12" />
            </StatCell>
            <StatCell label="Audits">
              <Skeleton className="h-4 w-10" />
            </StatCell>
          </>
        }
        {...removeProps}
        body={
          <div className="space-y-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        }
        footer={<Skeleton className="h-8 w-full rounded-lg" />}
      />
    );
  }

  if (!skill) {
    return (
      <ColumnShell
        title={skillId}
        subtitle={<span className="block truncate">{source}</span>}
        accent={accent}
        stats={
          <>
            <StatCell label="Installs">
              <StatDash />
            </StatCell>
            <StatCell label="Rank">
              <StatDash />
            </StatCell>
            <StatCell label="Audits">
              <StatDash />
            </StatCell>
          </>
        }
        {...removeProps}
        body={
          <p className="text-sm text-muted-foreground">
            This skill could not be found. It may have been renamed or removed
            from skills.sh.
          </p>
        }
        footer={null}
      />
    );
  }

  const auditStatus = skill.worstAuditStatus;

  return (
    <ColumnShell
      title={skill.name}
      titleHref={`/${skill.source}/${skill.skillId}`}
      accent={accent}
      subtitle={
        <span className="flex min-w-0 items-center gap-1.5">
          <a
            href={`https://github.com/${skill.source}`}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate transition-colors hover:text-foreground hover:underline"
          >
            {skill.source}
          </a>
          {skill.curatedOwner && (
            <OfficialBadge owner={skill.curatedOwner} className="shrink-0" />
          )}
        </span>
      }
      stats={
        <>
          <StatCell label="Installs">
            <span className="tabular-nums">
              {formatInstalls(skill.installs)}
            </span>
          </StatCell>
          <StatCell label="Rank">
            {rankLoading ? (
              <Skeleton className="h-4 w-12" />
            ) : rank != null ? (
              <span className="tabular-nums">
                #{rank.toLocaleString("en-US")}
              </span>
            ) : (
              <StatDash />
            )}
          </StatCell>
          <StatCell label="Audits">
            {auditStatus === "pass" ||
            auditStatus === "warn" ||
            auditStatus === "fail" ? (
              <AuditBadge status={auditStatus} />
            ) : (
              <StatDash />
            )}
          </StatCell>
        </>
      }
      {...removeProps}
      body={
        <div className="space-y-8">
          {skill.isDelisted && (
            <div className="rounded-lg border border-warning-border bg-warning px-4 py-3 text-sm text-warning-foreground">
              This skill is no longer listed on skills.sh
            </div>
          )}
          {skill.description && (
            <LabeledSection label="Overview">
              <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
                {skill.description}
              </p>
            </LabeledSection>
          )}
          {skill.content && (
            <LabeledSection label="Documentation">
              <MarkdownContent baseUrl={skill.skillMdUrl ?? null}>
                {skill.content}
              </MarkdownContent>
            </LabeledSection>
          )}
          {!skill.description && !skill.content && (
            <p className="text-sm text-muted-foreground">
              No documentation available for this skill.
            </p>
          )}
        </div>
      }
      footer={
        <BundleToggleButton
          source={skill.source}
          skillId={skill.skillId}
          name={skill.name}
        />
      }
    />
  );
}
