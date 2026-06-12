"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useQueryState } from "nuqs";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  Cancel01Icon,
  Link04Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import { LabeledSection } from "@/components/labeled-section";
import { MarkdownContent } from "@/components/markdown-content";
import { OfficialBadge } from "@/components/skill-badges";
import { Button } from "@/components/ui/cubby-ui/button";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import type { PickerSkill } from "@/components/skill-picker";
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

  return (
    <>
      {refs.length === 0 ? (
        <EmptyState onOpenPicker={openPicker} />
      ) : (
        <>
          <div className="mb-4 flex justify-end">
            <CopyComparisonLink refs={refs} />
          </div>
          <CompareGrid refs={refs} onOpenPicker={openPicker}>
          {refs.map((ref) => (
            <CompareColumn
              key={refKey(ref)}
              source={ref.source}
              skillId={ref.skillId}
              // A lone column has nothing left to compare against, so removal
              // stops making sense below two.
              onRemove={
                refs.length >= 2
                  ? () => removeSkill(ref.source, ref.skillId)
                  : undefined
              }
            />
          ))}
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
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(
      window.location.origin + compareHref(refs),
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button
      variant="outline"
      size="xs"
      onClick={handleCopy}
      leftSection={
        <HugeiconsIcon
          icon={copied ? Tick02Icon : Link04Icon}
          strokeWidth={2}
          className="size-3.5"
        />
      }
    >
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

function EmptyState({ onOpenPicker }: { onOpenPicker: () => void }) {
  return (
    <div className="py-16 text-center">
      <p className="text-lg font-medium">Nothing to compare yet</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick 2 or 3 skills to see their docs and stats side by side.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <ComparePickerEmptyTrigger onClick={onOpenPicker} />
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/" />}
          leftSection={
            <HugeiconsIcon
              icon={ArrowLeft01Icon}
              strokeWidth={2}
              className="size-4"
            />
          }
        >
          Back to home
        </Button>
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
        "-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 md:mx-0 md:grid md:gap-6 md:overflow-visible md:px-0 md:pb-0 " +
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
 * One compare column at its final dimensions: header band, fixed-height
 * scrollable body, action row. Pending, not-found, and loaded states render
 * the same shell so data arriving causes no layout shift.
 */
function ColumnShell({
  title,
  titleHref,
  meta,
  onRemove,
  removeLabel,
  body,
  footer,
}: {
  title: string;
  titleHref?: string;
  meta: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
  body: ReactNode;
  footer: ReactNode;
}) {
  return (
    <article className="flex w-[85%] shrink-0 snap-center flex-col sm:w-[70%] md:w-auto md:shrink">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">
            {titleHref ? (
              <Link href={titleHref} className="hover:underline">
                {title}
              </Link>
            ) : (
              title
            )}
          </h2>
          <div className="mt-1 flex h-5 min-w-0 items-center gap-2 text-sm text-muted-foreground">
            {meta}
          </div>
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={removeLabel}
            className="mt-1 shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring/50 focus-visible:outline-offset-2"
          >
            <HugeiconsIcon
              icon={Cancel01Icon}
              strokeWidth={2}
              className="size-3.5"
            />
          </button>
        )}
      </header>

      <div className="mt-4 h-[min(60vh,44rem)] overflow-y-auto overscroll-contain rounded-xl border p-5">
        {body}
      </div>

      <div className="mt-4">{footer}</div>
    </article>
  );
}

function CompareColumn({
  source,
  skillId,
  onRemove,
}: {
  source: string;
  skillId: string;
  onRemove?: () => void;
}) {
  // One query per column — the skills row carries everything including the
  // SKILL.md content. React Query caches it for the session, so re-adding a
  // column or revisiting the page in-session doesn't refetch.
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
        meta={<Skeleton className="h-4 w-40 max-w-full" />}
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
        meta={<span className="truncate">{source}</span>}
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

  return (
    <ColumnShell
      title={skill.name}
      titleHref={`/${skill.source}/${skill.skillId}`}
      meta={
        <>
          {skill.curatedOwner && <OfficialBadge owner={skill.curatedOwner} />}
          <span className="shrink-0 tabular-nums">
            {formatInstalls(skill.installs)} installs
          </span>
          <span aria-hidden="true">·</span>
          <a
            href={`https://github.com/${skill.source}`}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate transition-colors hover:text-foreground hover:underline"
          >
            {skill.source}
          </a>
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
