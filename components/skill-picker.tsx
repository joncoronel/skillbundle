"use client";

import { createContext, use, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Cancel01Icon,
  Search01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/cubby-ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/cubby-ui/input-group";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { DotMatrixRipple } from "@/components/ui/dot-matrix-ripple";
import { skillPickerSearchOptions } from "@/hooks/use-skill-picker-search";
import { renderHighlight } from "@/lib/search/highlight";
import { formatInstalls } from "@/lib/utils";

// Shared skill-picker building blocks: a search field plus a result list with
// add/remove actions per row. The bundle-edit sheet and the compare picker
// compose these with their own cap logic and copy.

export interface PickerSkill {
  source: string;
  skillId: string;
  name: string;
  /** Typesense `<mark>`-wrapped name for search rows; render via renderHighlight. */
  nameHighlight?: string;
  description?: string;
  installs: number;
  curatedOwner?: string;
  worstAuditStatus?: string;
  worstAuditRiskLevel?: string;
}

export function skillKey(source: string, skillId: string) {
  return `${source}::${skillId}`;
}

/**
 * Per-row labels naming what skills are added to ("bundle", "comparison").
 * The dynamic labels take the skill's source too: names collide across repos
 * (the same skill republished from several sources), so a name-only label
 * gives screen readers three identical "Add X" buttons.
 */
export interface SkillPickerCopy {
  /** aria-label of the ✓ shown beside already-added skills. */
  added: string;
  add: (name: string, source: string) => string;
  /** Add aria-label while the cap blocks adding; should say why. */
  addDisabled: (name: string, source: string) => string;
  remove: (name: string, source: string) => string;
}

export function SkillSearchField({
  value,
  onChange,
  loading,
  placeholder = "Search skills by name…",
}: {
  value: string;
  onChange: (value: string) => void;
  loading?: boolean;
  placeholder?: string;
}) {
  return (
    <InputGroup variant="elevated">
      <InputGroupAddon>
        {loading ? (
          <DotMatrixRipple size="xs" ariaLabel="Searching" />
        ) : (
          <HugeiconsIcon icon={Search01Icon} strokeWidth={2} />
        )}
      </InputGroupAddon>
      <InputGroupInput
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon_xs"
            aria-label="Clear search"
            onClick={() => onChange("")}
          >
            <HugeiconsIcon
              icon={Cancel01Icon}
              strokeWidth={2}
              className="size-4"
            />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}

interface PickerContextValue {
  existingKeys: Set<string>;
  atCap: boolean;
  copy: SkillPickerCopy;
  onAdd: (skill: PickerSkill) => void;
  onRemove: (source: string, skillId: string) => void;
}

const PickerContext = createContext<PickerContextValue | null>(null);

/**
 * Owns the picker's shared selection contract (what's added, the cap, the
 * copy, the add/remove handlers) so the list components stay pure structure —
 * rows read it via context instead of a 5-prop bundle drilled through them.
 */
export function PickerProvider({
  children,
  ...value
}: PickerContextValue & { children: React.ReactNode }) {
  const { existingKeys, atCap, copy, onAdd, onRemove } = value;
  const memoized = useMemo(
    () => ({ existingKeys, atCap, copy, onAdd, onRemove }),
    [existingKeys, atCap, copy, onAdd, onRemove],
  );
  return <PickerContext value={memoized}>{children}</PickerContext>;
}

function usePicker(): PickerContextValue {
  const context = use(PickerContext);
  if (!context) {
    throw new Error("Picker components must be used within a PickerProvider.");
  }
  return context;
}

export function PickerSearchResults({ query }: { query: string }) {
  // Same query (key + fn) as useSkillPickerSearch in the parent sheet, so the
  // spinner and this list share one cache entry and one network request.
  const { data, isPending, isError } = useQuery(skillPickerSearchOptions(query));

  if (isPending) {
    return <PickerListSkeleton />;
  }

  if (isError) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Search is unavailable right now. Try again in a moment.
      </p>
    );
  }

  const results = data?.hits ?? [];
  if (results.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No skills found for &ldquo;{query}&rdquo;
      </p>
    );
  }

  return (
    <PickerList>
      {/* SkillHit is structurally a PickerSkill (plus engine fields) — no
          field-by-field mapping to maintain. */}
      {results.map((s) => (
        <PickerRow key={skillKey(s.source, s.skillId)} skill={s} />
      ))}
    </PickerList>
  );
}

export function PickerPopularResults() {
  const { data, isPending } = useQuery({
    ...convexQuery(api.skills.listPopularSkills, {
      paginationOpts: { numItems: 30, cursor: null },
    }),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  if (isPending) {
    return <PickerListSkeleton />;
  }

  const results = data?.page ?? [];
  if (results.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No skills to show.
      </p>
    );
  }

  return (
    <>
      <p className="text-xs text-muted-foreground">Popular skills</p>
      <PickerList>
        {/* The summary row is structurally a PickerSkill — pass it through. */}
        {results.map((s) => (
          <PickerRow key={skillKey(s.source, s.skillId)} skill={s} />
        ))}
      </PickerList>
    </>
  );
}

export function PickerList({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col divide-y divide-border/60 rounded-xl border bg-card dark:border-border/50">
      {children}
    </div>
  );
}

export function PickerListSkeleton() {
  // Mirrors the PickerRow layout: a column with name + source row, an
  // optional description line, an install count, and a trailing Add button.
  return (
    <PickerList>
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 px-3 py-3" aria-hidden>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-baseline gap-2">
              <Skeleton className="h-3.5 w-28 rounded-sm" />
              <Skeleton className="h-3 w-20 rounded-sm" />
            </div>
            <Skeleton className="h-3 w-full rounded-sm" />
            <Skeleton className="h-3 w-16 rounded-sm" />
          </div>
          <Skeleton className="h-7 w-14 shrink-0 rounded-md" />
        </div>
      ))}
    </PickerList>
  );
}

export function PickerRow({ skill }: { skill: PickerSkill }) {
  const { existingKeys, atCap, copy, onAdd, onRemove } = usePicker();
  const key = useMemo(
    () => skillKey(skill.source, skill.skillId),
    [skill.source, skill.skillId],
  );
  const added = existingKeys.has(key);
  // The cap only blocks adds. Removes never violate the cap, so a row
  // that's already staged keeps a working Remove button at all times.
  const addDisabled = atCap && !added;

  return (
    <div className="flex items-start gap-3 px-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          {added ? (
            // Small inline state indicator so the list is scannable
            // ("which of these are already added?") without making the
            // action button do the work of communicating state.
            <HugeiconsIcon
              icon={Tick02Icon}
              strokeWidth={2}
              className="size-3.5 self-center text-success-foreground/70"
              aria-label={copy.added}
            />
          ) : null}
          <span className="text-sm font-semibold leading-tight">
            {skill.nameHighlight
              ? renderHighlight(skill.nameHighlight)
              : skill.name}
          </span>
          <span className="text-xs text-muted-foreground">{skill.source}</span>
        </div>
        {skill.description ? (
          <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
            {skill.description}
          </p>
        ) : null}
        <p className="mt-1 text-micro tabular-nums text-muted-foreground/80">
          {formatInstalls(skill.installs)} installs
        </p>
      </div>
      {added ? (
        // Always-visible Remove button. Destructive on hover so the
        // commit intent is clear before the click. State is already
        // communicated by the inline ✓ next to the skill name, so the
        // button itself doesn't need to do double duty.
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => onRemove(skill.source, skill.skillId)}
          aria-label={copy.remove(skill.name, skill.source)}
          // Fill AND border go through the --btn-* tokens: the recipe paints
          // both on a ::before pseudo, so `hover:bg-*` would be hidden beneath
          // outline's opaque hover fill and `hover:border-*` would colour a
          // root that carries no border width. --btn-bg-active is set too,
          // else pressing snaps back to outline's card darken mid-gesture.
          className="shrink-0 text-destructive transition-colors [--btn-bg-hover:color-mix(in_oklab,var(--destructive)_10%,transparent)] [--btn-bg-active:color-mix(in_oklab,var(--destructive)_15%,transparent)] hover:[--btn-border:color-mix(in_oklab,var(--destructive)_30%,transparent)] hover:text-destructive"
          leadingIcon={
            <HugeiconsIcon
              icon={Cancel01Icon}
              strokeWidth={2}
              className="size-3.5"
            />
          }
        >
          Remove
        </Button>
      ) : (
        // Add disables at cap. No per-row tooltip — the status line above
        // the result list already explains why every Add is disabled, so
        // tooltips on every row would be redundant chrome. Screen readers
        // still get the cap context via aria-label.
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => onAdd(skill)}
          disabled={addDisabled}
          aria-label={
            addDisabled
              ? copy.addDisabled(skill.name, skill.source)
              : copy.add(skill.name, skill.source)
          }
          className="shrink-0"
          leadingIcon={
            <HugeiconsIcon
              icon={Add01Icon}
              strokeWidth={2}
              className="size-3.5"
            />
          }
        >
          Add
        </Button>
      )}
    </div>
  );
}
