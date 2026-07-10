"use client";

import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FilterHorizontalIcon,
  Cancel01Icon,
  UnfoldMoreIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/cubby-ui/select";
import {
  Combobox,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxStatus,
  ComboboxTrigger,
} from "@/components/ui/cubby-ui/combobox/combobox";
import { useAsyncCombobox } from "@/components/ui/cubby-ui/combobox/hooks/use-async-combobox";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/cubby-ui/dropdown-menu";
import { Button } from "@/components/ui/cubby-ui/button";
import { Switch } from "@/components/ui/cubby-ui/switch";
import { DotMatrixRipple } from "@/components/ui/dot-matrix-ripple";
import { formatInstalls, cn } from "@/lib/utils";
import {
  listOwners,
  type FacetCount,
  type OwnerCount,
} from "@/lib/search/typesense";
import type { AuditFilterValue, CatalogSortValue } from "@/lib/search-params";

export interface CatalogControlsProps {
  /** Effective sort (auto-resolved when the URL param is unset). */
  sort: CatalogSortValue;
  /** Whether a text query is active — gates the Relevance option. */
  hasQuery: boolean;
  onSortChange: (sort: CatalogSortValue) => void;
  /** Official filter. On desktop its control is the icon toggle in the
   *  composer's input row (so the chin's Clear/count ignore it); in the mobile
   *  sheet it's a labeled switch here, and the sheet's count includes it —
   *  Clear covers the controls that share its surface. */
  official: boolean;
  onOfficialChange: (v: boolean) => void;
  /** Search scope (names vs names+descriptions). Sheet-only switch here; on
   *  desktop it's the composer's icon toggle. Scope, not a filter — never
   *  counted in Clear. */
  searchDescriptions: boolean;
  onSearchDescriptionsChange: (v: boolean) => void;
  /** Publisher owner slugs to narrow to (any-of); [] = any publisher. */
  publisher: string[];
  onPublisherChange: (v: string[]) => void;
  audit: AuditFilterValue | null;
  onAuditChange: (v: AuditFilterValue | null) => void;
  minInstalls: number | null;
  onMinInstallsChange: (v: number | null) => void;
  /** true = skills with failing SKILL.md fetches are hidden. */
  broken: boolean;
  onBrokenChange: (v: boolean) => void;
  /** Reset every filter (not the sort) back to its broad default. */
  onClearFilters: () => void;
  /** Facet counts from the current result set (active state only). */
  facets?: Record<string, FacetCount[]>;
  /**
   * "bar" (default) — the inline composer row: scoped-select pills + a "More"
   * dropdown. "sheet" — full-width stacked controls for the mobile drawer.
   */
  layout?: "bar" | "sheet";
}

const SORT_LABELS: Record<CatalogSortValue, string> = {
  relevance: "Relevance",
  installs: "Most installed",
};

// Sentinel for "no narrowing" select/radio items — Base UI needs a non-null
// value, so the broad default gets an explicit one.
const ANY = "any";

const MIN_INSTALL_PRESETS = [100, 1_000, 10_000] as const;

const AUDIT_ITEMS = {
  [ANY]: "Any audit",
  pass: "Passed audit",
  nofail: "No failed audits",
};
const MIN_INSTALL_ITEMS = {
  [ANY]: "Any installs",
  ...Object.fromEntries(
    MIN_INSTALL_PRESETS.map((n) => [
      String(n),
      `${formatInstalls(n)}+ installs`,
    ]),
  ),
};

/**
 * The catalog sort picker, standalone so the composer can mount it in the
 * input's control row (next to the search scope tabs) while the mobile filter
 * sheet keeps its own full-width copy. Relevance is only offered while a text
 * query exists — with no query every hit ties at zero relevance.
 */
export function SortSelect({
  sort,
  hasQuery,
  onSortChange,
  className,
  inSheet = false,
  ghost = false,
}: {
  sort: CatalogSortValue;
  hasQuery: boolean;
  onSortChange: (sort: CatalogSortValue) => void;
  className?: string;
  /** Inside the mobile drawer: elevated trigger, no scroll lock, no align. */
  inSheet?: boolean;
  /** Borderless trigger — for the composer's input control row. */
  ghost?: boolean;
}) {
  return (
    <Select
      value={sort}
      onValueChange={(v) => {
        if (v) onSortChange(v as CatalogSortValue);
      }}
      items={SORT_LABELS}
      modal={inSheet ? false : undefined}
    >
      <SelectTrigger
        size="sm"
        variant={inSheet ? "elevated" : ghost ? "ghost" : "default"}
        aria-label="Sort catalog"
        className={className}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={!inSheet} level={inSheet ? 7 : 5}>
        <SelectItem value="relevance" disabled={!hasQuery}>
          Relevance
        </SelectItem>
        <SelectItem value="installs">Most installed</SelectItem>
      </SelectContent>
    </Select>
  );
}

function facetCount(
  facets: Record<string, FacetCount[]> | undefined,
  field: string,
  value: string,
): number | undefined {
  const counts = facets?.[field];
  if (!counts) return undefined;
  return counts.find((c) => c.value === value)?.count;
}

function ItemCount({ count }: { count: number | undefined }) {
  if (count === undefined) return null;
  return (
    <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">
      {formatInstalls(count)}
    </span>
  );
}

/**
 * The catalog's sort + filter controls, in two presentations (same state):
 *
 * - **bar** (desktop composer row): Official + Audit as scoped-select pills,
 *   with minimum-installs / description-search / hide-broken behind "More"
 *   (badge shows how many filters are active). Only the two differentiators
 *   stay visible so the row doesn't sprawl.
 * - **sheet** (mobile drawer): every control full-width and stacked, so the
 *   whole thing is reachable one-handed.
 *
 * Purely presentational: state comes in via props (nuqs lives in
 * SkillExplorer), so the home fallback can render it statically with defaults.
 */
export function CatalogControls({
  sort,
  hasQuery,
  onSortChange,
  official,
  onOfficialChange,
  searchDescriptions,
  onSearchDescriptionsChange,
  publisher,
  onPublisherChange,
  audit,
  onAuditChange,
  minInstalls,
  onMinInstallsChange,
  broken,
  onBrokenChange,
  onClearFilters,
  facets,
  layout = "bar",
}: CatalogControlsProps) {
  const passCount = facetCount(facets, "worstAuditStatus", "pass");

  // Inside the mobile sheet the selects must NOT lock body scroll (the sheet
  // already does — double-locking flickers the scrollbar-compensation padding
  // and shifts the whole page + sheet on repeated taps), and alignItemWithTrigger
  // is dropped (its measure-then-reposition is unstable in a scrollable sheet).
  const inSheet = layout === "sheet";
  const selectAlign = !inSheet;
  const selectModal = inSheet ? false : undefined;
  // Popups sit one clear tier above their substrate: above the sheet (level 5)
  // on mobile, above the composer card (level 3) on desktop.
  const popupLevel = inSheet ? 7 : 5;
  // Elevated (translucent overlay) triggers in the sheet; ghost in the chin —
  // the composer's inner surface is the loud instrument, the chin stays quiet
  // (borderless until hover), with the selected value carrying the state.
  const triggerVariant = inSheet ? ("elevated" as const) : ("ghost" as const);

  // Clear covers the controls that share its surface: the chin's Clear counts
  // only chin filters (Official lives up in the input row there, with its own
  // visible pressed state); the sheet's count includes Official since the
  // sheet is its mobile home. Search scope is never a filter.
  const activeFilterCount =
    (inSheet && official ? 1 : 0) +
    (publisher.length > 0 ? 1 : 0) +
    (audit ? 1 : 0) +
    (minInstalls !== null ? 1 : 0) +
    (broken ? 1 : 0);

  const publisherSelect = (className?: string) => (
    <PublisherSelect
      value={publisher}
      onChange={onPublisherChange}
      className={className}
      inSheet={inSheet}
    />
  );

  const sortSelect = (className?: string) => (
    <SortSelect
      sort={sort}
      hasQuery={hasQuery}
      onSortChange={onSortChange}
      className={className}
      inSheet={inSheet}
    />
  );

  const auditSelect = (className?: string) => (
    <Select
      value={audit ?? ANY}
      onValueChange={(v) => {
        if (v) onAuditChange(v === ANY ? null : (v as AuditFilterValue));
      }}
      items={AUDIT_ITEMS}
      modal={selectModal}
    >
      <SelectTrigger
        size="sm"
        variant={triggerVariant}
        aria-label="Filter by security audit"
        className={cn(
          // The ghost variant rests muted; keep full foreground once a
          // narrowing value is set (state lives in the value text).
          !inSheet && audit && "text-foreground",
          className,
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={selectAlign} level={popupLevel}>
        <SelectItem value={ANY}>Any audit</SelectItem>
        <SelectItem value="pass">
          Passed audit
          <ItemCount count={passCount} />
        </SelectItem>
        <SelectItem value="nofail">No failed audits</SelectItem>
      </SelectContent>
    </Select>
  );

  const minInstallsSelect = (className?: string) => (
    <Select
      value={minInstalls !== null ? String(minInstalls) : ANY}
      onValueChange={(v) => {
        if (v) onMinInstallsChange(v === ANY ? null : Number(v));
      }}
      items={MIN_INSTALL_ITEMS}
      modal={selectModal}
    >
      <SelectTrigger
        size="sm"
        variant={triggerVariant}
        aria-label="Filter by minimum installs"
        className={className}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={selectAlign} level={popupLevel}>
        <SelectItem value={ANY}>Any installs</SelectItem>
        {MIN_INSTALL_PRESETS.map((n) => (
          <SelectItem key={n} value={String(n)}>
            {formatInstalls(n)}+ installs
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const clearButton = (className?: string) =>
    activeFilterCount > 0 ? (
      <Button
        variant="ghost"
        size="sm"
        className={cn("text-muted-foreground", className)}
        onClick={onClearFilters}
        leftSection={
          <HugeiconsIcon
            icon={Cancel01Icon}
            strokeWidth={2}
            className="size-3.5"
          />
        }
      >
        Clear ({activeFilterCount})
      </Button>
    ) : null;

  // ---- Sheet layout: full-width, stacked (mobile drawer) --------------------
  // No Clear here — it lives in the sheet's header (skill-explorer), so its
  // appearance never shifts this content.
  if (layout === "sheet") {
    return (
      <div className="flex flex-col gap-4">
        <Field label="Sort by">{sortSelect("w-full")}</Field>
        <Field label="Publisher">{publisherSelect("w-full")}</Field>
        <Field label="Security">{auditSelect("w-full")}</Field>
        <Field label="Minimum installs">{minInstallsSelect("w-full")}</Field>

        <SwitchRow
          label="Official skills only"
          hint="Only skills from verified publishers"
          checked={official}
          onCheckedChange={onOfficialChange}
        />
        <SwitchRow
          label="Search descriptions"
          hint="Match on description text, not just names"
          checked={searchDescriptions}
          onCheckedChange={onSearchDescriptionsChange}
        />
        <SwitchRow
          label="Hide broken installs"
          hint="Skip skills whose install command may fail"
          checked={broken}
          onCheckedChange={onBrokenChange}
        />
      </div>
    );
  }

  // ---- Bar layout: the composer chin (desktop) -------------------------------
  // Result-narrowing filters only — the sort and the Official/descriptions
  // toggles live up in the input's control row (they're the high-frequency
  // one-click controls; the chin keeps the heavier pickers).
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {publisherSelect()}
      {auditSelect()}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              aria-label="More filters"
              leftSection={
                <HugeiconsIcon
                  icon={FilterHorizontalIcon}
                  strokeWidth={2}
                  className="size-3.5"
                />
              }
              rightSection={
                minInstalls !== null || broken ? (
                  <span className="flex size-4.5 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground tabular-nums">
                    {(minInstalls !== null ? 1 : 0) + (broken ? 1 : 0)}
                  </span>
                ) : undefined
              }
            />
          }
        >
          More
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="bottom"
          align="end"
          level={popupLevel}
          className="min-w-56"
        >
          <DropdownMenuLabel>Minimum installs</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={minInstalls !== null ? String(minInstalls) : ANY}
            onValueChange={(v) =>
              onMinInstallsChange(v === ANY ? null : Number(v))
            }
          >
            <DropdownMenuRadioItem value={ANY} closeOnClick={false}>
              Any
            </DropdownMenuRadioItem>
            {MIN_INSTALL_PRESETS.map((n) => (
              <DropdownMenuRadioItem
                key={n}
                value={String(n)}
                closeOnClick={false}
              >
                {formatInstalls(n)}+ installs
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>

          <DropdownMenuSeparator />

          <DropdownMenuCheckboxItem
            checked={broken}
            onCheckedChange={(checked) => onBrokenChange(!!checked)}
            closeOnClick={false}
          >
            Hide broken installs
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {clearButton()}
    </div>
  );
}

/** A publisher row for the async picker (`id` = the owner slug). */
type OwnerItem = { id: string; count: number };

// Publisher search timing. The debounce runs *inside* searchFn (so `isPending`
// covers it — no gap for a false "no match" flash), and the min-visible floor
// keeps the loading state from blinking on a quick/cached response.
const OWNERS_STALE_MS = 5 * 60_000;
const DEBOUNCE_MS = 200;
const MIN_VISIBLE_MS = 350;

/** Abortable delay — rejects with AbortError when the signal fires. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted)
      return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

const toItem = (o: OwnerCount): OwnerItem => ({ id: o.value, count: o.count });

/**
 * Publisher (owner) filter — a type-to-search combobox backed by
 * `useAsyncCombobox`: it debounces, cancels stale requests, keeps selected
 * publishers visible, and (via useTransition) holds the current list on screen
 * while new matches load, so there's no flash/relayout between keystrokes.
 * Multi-select (any-of); the trigger shows a summary, the popup a checkable
 * list. Type-to-search only — the catalog has too many publishers to browse.
 */
function PublisherSelect({
  value,
  onChange,
  className,
  inSheet,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  className?: string;
  inSheet: boolean;
}) {
  const queryClient = useQueryClient();

  // Facet search as the user types, with the debounce + min-visible floor +
  // React Query caching all folded into one searchFn (see the constants above):
  //   1. a fresh cache hit returns instantly — RQ's speed win, no spinner;
  //   2. otherwise debounce (abortable, so rapid keystrokes cancel it),
  //   3. fetch through RQ (cache + dedup),
  //   4. pad to the min-visible floor so a fast/near-instant fetch doesn't
  //      blink the loading state.
  // Because the wait runs inside searchFn, the hook's `isPending` covers it,
  // so there's never a window where the list is empty and "pending" is false.
  const searchFn = useCallback(
    async (query: string, signal: AbortSignal): Promise<OwnerItem[]> => {
      const key = ["typesense-owners", query] as const;
      const cached = queryClient.getQueryState<OwnerCount[]>(key);
      if (cached?.data && Date.now() - cached.dataUpdatedAt < OWNERS_STALE_MS) {
        return cached.data.map(toItem);
      }

      const startedAt = performance.now();
      await sleep(DEBOUNCE_MS, signal);
      const owners = await queryClient.fetchQuery({
        queryKey: key,
        queryFn: ({ signal: s }) => listOwners({ query, signal: s }),
        staleTime: OWNERS_STALE_MS,
      });
      const elapsed = performance.now() - startedAt;
      if (elapsed < MIN_VISIBLE_MS) {
        await sleep(MIN_VISIBLE_MS - elapsed, signal);
      }
      return owners.map(toItem);
    },
    [queryClient],
  );

  // Selected items (id = slug), stable while the value's contents are unchanged
  // so the hook's memoized merges don't churn every render.
  const valueKey = value.join(",");
  const selected = useMemo<OwnerItem[]>(
    () => value.map((v) => ({ id: v, count: 0 })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [valueKey],
  );

  const { items, comboboxProps, isPending, error, query } =
    useAsyncCombobox<OwnerItem>({
      searchFn,
      multiple: true,
      // debounce is handled inside searchFn (so isPending covers it)
      value: selected,
      onValueChange: (next: OwnerItem[]) => onChange(next.map((o) => o.id)),
    });

  const label =
    value.length === 0
      ? "Publisher"
      : value.length === 1
        ? value[0]
        : `${value.length} publishers`;

  // Status text above the list. The spinner itself lives in the input's `end`
  // slot; here we only surface text when there's nothing else to show, so the
  // list is never replaced mid-search. "No match" is guarded on !isPending so
  // it can't flash while a search is in flight.
  const status = () => {
    if (error) return error;
    if (isPending && items.length === 0) return "Searching…";
    if (query === "") {
      return value.length === 0 ? "Type to find a publisher…" : null;
    }
    if (!isPending && items.length === 0)
      return `No publishers match “${query}”.`;
    return null;
  };

  return (
    <Combobox<OwnerItem, true>
      multiple
      items={items}
      value={selected}
      onValueChange={(next: OwnerItem[]) => onChange(next.map((o) => o.id))}
      isItemEqualToValue={(a: OwnerItem, b: OwnerItem) => a.id === b.id}
      itemToStringLabel={(o: OwnerItem) => o.id}
      modal={inSheet ? false : undefined}
      {...comboboxProps}
    >
      <ComboboxTrigger
        render={(triggerProps: React.ComponentProps<"button">) => (
          <Button
            {...triggerProps}
            size="sm"
            variant={inSheet ? "outline" : "ghost"}
            aria-label="Filter by publisher"
            className={cn(
              // No active-state border — the label ("2 publishers") is the
              // indicator, matching the other filter pills (which don't tint).
              "justify-between gap-2 px-2.5",
              // Match the Select triggers' surface: ghost in the composer chin,
              // translucent-elevated in the mobile sheet.
              inSheet
                ? "bg-input-elevated hover:bg-surface-hover hover:text-foreground"
                : // -ms pulls the ghost trigger's TEXT onto the chin's 12px
                  // optical line (its invisible box overhangs the gutter).
                  "-ms-2.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              value.length > 0 && "text-foreground",
              className,
            )}
            rightSection={
              <HugeiconsIcon
                icon={UnfoldMoreIcon}
                strokeWidth={2}
                className="size-4 text-muted-foreground"
              />
            }
          >
            <span
              className={cn(
                "truncate",
                value.length === 0 && "text-muted-foreground",
              )}
            >
              {label}
            </span>
          </Button>
        )}
      />
      <ComboboxPopup
        level={inSheet ? 7 : 5}
        align="start"
        className="flex min-w-60 flex-col p-0"
      >
        <div className="border-b border-border p-2">
          <ComboboxInput
            variant="elevated"
            placeholder="Search publishers…"
            showTrigger={false}
            showClear={false}
            aria-busy={isPending}
            start={
              <HugeiconsIcon
                icon={Search01Icon}
                strokeWidth={2}
                className="text-muted-foreground"
              />
            }
            end={
              isPending ? (
                <DotMatrixRipple size="xs" ariaLabel="Searching publishers" />
              ) : null
            }
          />
        </div>
        <ComboboxStatus className="empty:hidden">{status()}</ComboboxStatus>
        {/* Dim (don't replace) stale results while the next query resolves, so
            there's no relayout. Gated on items so a first search doesn't fade
            in from dim. */}
        <ComboboxList
          className={cn(
            "transition-opacity duration-150",
            isPending && items.length > 0 && "opacity-50",
          )}
        >
          {(o: OwnerItem) => (
            <ComboboxItem key={o.id} value={o}>
              <span className="truncate">{o.id}</span>
              {o.count > 0 ? <ItemCount count={o.count} /> : null}
            </ComboboxItem>
          )}
        </ComboboxList>
        {value.length > 0 ? (
          <div className="border-t border-border p-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground"
              onClick={() => onChange([])}
              leftSection={
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  strokeWidth={2}
                  className="size-3.5"
                />
              }
            >
              Clear publishers
            </Button>
          </div>
        ) : null}
      </ComboboxPopup>
    </Combobox>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function SwitchRow({
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer">
      <span className="flex flex-col">
        <span className="text-sm">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}
