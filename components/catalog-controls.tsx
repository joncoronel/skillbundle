"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { FilterHorizontalIcon, Cancel01Icon } from "@hugeicons/core-free-icons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/cubby-ui/select";
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
import { formatInstalls, cn } from "@/lib/utils";
import type { FacetCount } from "@/lib/search/typesense";
import type { AuditFilterValue, CatalogSortValue } from "@/lib/search-params";

export interface CatalogControlsProps {
  /** Effective sort (auto-resolved when the URL param is unset). */
  sort: CatalogSortValue;
  /** Whether a text query is active — gates the Relevance option. */
  hasQuery: boolean;
  onSortChange: (sort: CatalogSortValue) => void;
  official: boolean;
  onOfficialChange: (v: boolean) => void;
  audit: AuditFilterValue | null;
  onAuditChange: (v: AuditFilterValue | null) => void;
  minInstalls: number | null;
  onMinInstallsChange: (v: number | null) => void;
  /** true = search names AND descriptions; default (false) searches names only. */
  searchDescriptions: boolean;
  onSearchDescriptionsChange: (v: boolean) => void;
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

const OFFICIAL_ITEMS = { [ANY]: "All skills", official: "Official only" };
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
  audit,
  onAuditChange,
  minInstalls,
  onMinInstallsChange,
  searchDescriptions,
  onSearchDescriptionsChange,
  broken,
  onBrokenChange,
  onClearFilters,
  facets,
  layout = "bar",
}: CatalogControlsProps) {
  const officialCount = facetCount(facets, "isOfficial", "true");
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
  // Elevated (translucent overlay) triggers only in the sheet, which sits on an
  // elevated surface; the desktop bar keeps the default opaque triggers.
  const triggerVariant = inSheet ? "elevated" : "default";

  const activeFilterCount =
    (official ? 1 : 0) +
    (audit ? 1 : 0) +
    (minInstalls !== null ? 1 : 0) +
    (broken ? 1 : 0);

  const sortSelect = (className?: string) => (
    <Select
      value={sort}
      onValueChange={(v) => {
        if (v) onSortChange(v as CatalogSortValue);
      }}
      items={SORT_LABELS}
      modal={selectModal}
    >
      <SelectTrigger
        size="sm"
        variant={triggerVariant}
        aria-label="Sort catalog"
        className={className}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={selectAlign} level={popupLevel}>
        <SelectItem value="relevance" disabled={!hasQuery}>
          Relevance
        </SelectItem>
        <SelectItem value="installs">Most installed</SelectItem>
      </SelectContent>
    </Select>
  );

  const officialSelect = (className?: string) => (
    <Select
      value={official ? "official" : ANY}
      onValueChange={(v) => {
        if (v) onOfficialChange(v === "official");
      }}
      items={OFFICIAL_ITEMS}
      modal={selectModal}
    >
      <SelectTrigger
        size="sm"
        variant={triggerVariant}
        aria-label="Filter by publisher type"
        className={className}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={selectAlign} level={popupLevel}>
        <SelectItem value={ANY}>All skills</SelectItem>
        <SelectItem value="official">
          Official only
          <ItemCount count={officialCount} />
        </SelectItem>
      </SelectContent>
    </Select>
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
        className={className}
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
  if (layout === "sheet") {
    return (
      <div className="flex flex-col gap-4">
        <Field label="Sort by">{sortSelect("w-full")}</Field>
        <Field label="Publisher">{officialSelect("w-full")}</Field>
        <Field label="Security">{auditSelect("w-full")}</Field>
        <Field label="Minimum installs">{minInstallsSelect("w-full")}</Field>

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

        {activeFilterCount > 0 && <div className="pt-1">{clearButton()}</div>}
      </div>
    );
  }

  // ---- Bar layout: inline pills + "More" dropdown (desktop composer) --------
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {sortSelect()}
      {officialSelect()}
      {auditSelect()}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="sm"
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
            checked={searchDescriptions}
            onCheckedChange={(checked) => onSearchDescriptionsChange(!!checked)}
            closeOnClick={false}
          >
            Search descriptions
          </DropdownMenuCheckboxItem>
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
