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
import { Switch } from "@/components/ui/cubby-ui/switch/switch";
import { LabeledSection } from "@/components/labeled-section";
import { ItemCount } from "@/components/item-count";
import { PublisherSelect } from "@/components/publisher-select";
import {
  useCatalogFacets,
  useExplorerState,
} from "@/components/explorer-state";
import { formatInstalls, cn } from "@/lib/utils";
import type { FacetCount } from "@/lib/search/typesense";
import type { AuditFilterValue, CatalogSortValue } from "@/lib/search-params";

const SORT_LABELS: Record<CatalogSortValue, string> = {
  relevance: "Relevance",
  installs: "Most installed",
};

// Sentinel for "no narrowing" select/radio items — Base UI needs a non-null
// value, so the broad default gets an explicit one.
const ANY = "any";

const MIN_INSTALL_PRESETS = [100, 1_000, 10_000] as const;

// The boolean filters render as a switch on BOTH surfaces — a menu indicator
// in the chin's "More", a real control in the mobile sheet. Shape is shared so
// they are recognisably the same control.
//
// Motion is NOT, deliberately. `stretch` moves the thumb's two edges on
// separate schedules, which no transform expresses, so it animates
// `left`/`right` and reflows the thumb every frame; `default` slides on the
// compositor. The chin is desktop-only and can afford the nicer timeline. The
// sheet is the touch surface, and paying a per-frame reflow there is what made
// these switches stutter in the drawer. Nobody sees both at once — the two
// surfaces are mutually exclusive by viewport — so the split costs nothing.
const FILTER_SWITCH = {
  shape: "squircle",
  menuMotion: "stretch",
  sheetMotion: "default",
} as const;

// Single source for a preset's label and for parsing the select value back to
// the param, so the standalone select and the "More" radio group can't drift.
const minInstallLabel = (n: number) => `${formatInstalls(n)}+ installs`;
const parseMinInstalls = (v: string): number | null =>
  v === ANY ? null : Number(v);

const AUDIT_ITEMS = {
  [ANY]: "Any audit",
  pass: "Passed audits only",
  nofail: "Hide failed audits",
};
const MIN_INSTALL_ITEMS = {
  [ANY]: "Any installs",
  ...Object.fromEntries(
    MIN_INSTALL_PRESETS.map((n) => [String(n), minInstallLabel(n)]),
  ),
};

// Where a control renders decides its popup behavior + trigger chrome:
// - chin (desktop composer): ghost triggers (the chin stays quiet; selected
//   values carry the state), popups one tier above the composer card.
// - sheet (mobile drawer): elevated triggers; selects must NOT lock body
//   scroll (the sheet already does — double-locking flickers the
//   scrollbar-compensation padding), alignItemWithTrigger is dropped (its
//   measure-then-reposition is unstable in a scrollable sheet), and popups
//   sit one tier above the sheet.
export type ControlSurface = "chin" | "sheet";
const surfaceProps = (surface: ControlSurface) =>
  ({
    inSheet: surface === "sheet",
    selectAlign: surface !== "sheet",
    selectModal: surface === "sheet" ? false : undefined,
    popupLevel: surface === "sheet" ? 7 : 5,
    triggerVariant:
      surface === "sheet" ? ("elevated" as const) : ("ghost" as const),
  }) as const;

/** The small primary count pill shown on a filter trigger (chin "More", the
 *  mobile "Sort & filter" trigger).
 *
 *  Gate the CALL SITE on the count, not just this component. Returning `null`
 *  is invisible but the element is still truthy, and Button derives its
 *  leading/trailing padding from `!!leadingIcon` / `!!trailingIcon` — so an
 *  ungated badge reserves optical padding for a pill that never paints, and
 *  the trigger sits a few px tighter on that side than its own twin. */
export function FilterCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="flex size-4.5 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground tabular-nums">
      {count}
    </span>
  );
}

/**
 * The catalog sort picker, standalone so the composer chin mounts it next to
 * the navigation corner while the mobile filter sheet keeps its own
 * full-width copy. Relevance is only offered while a text query exists —
 * with no query every hit ties at zero relevance.
 */
export function SortSelect({
  surface = "chin",
  className,
}: {
  surface?: ControlSurface;
  className?: string;
}) {
  const { effectiveSort, hasQuery, changeSort } = useExplorerState();
  const { inSheet } = surfaceProps(surface);
  return (
    <Select
      value={effectiveSort}
      onValueChange={(v) => {
        if (v) changeSort(v as CatalogSortValue);
      }}
      items={SORT_LABELS}
      modal={inSheet ? false : undefined}
    >
      <SelectTrigger
        size="sm"
        variant={inSheet ? "elevated" : "ghost"}
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

function AuditSelect({
  surface,
  className,
}: {
  surface: ControlSurface;
  className?: string;
}) {
  const { audit, setParams } = useExplorerState();
  const facets = useCatalogFacets();
  const { inSheet, selectAlign, selectModal, popupLevel, triggerVariant } =
    surfaceProps(surface);
  const passCount = facetCount(facets, "worstAuditStatus", "pass");
  return (
    <Select
      value={audit ?? ANY}
      onValueChange={(v) => {
        if (v) setParams({ audit: v === ANY ? null : (v as AuditFilterValue) });
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
        {/* Labels come from AUDIT_ITEMS (single source, shared with the trigger
            display) — only the "pass" item adds a facet count. */}
        <SelectItem value={ANY}>{AUDIT_ITEMS[ANY]}</SelectItem>
        <SelectItem value="pass">
          {AUDIT_ITEMS.pass}
          <ItemCount count={passCount} />
        </SelectItem>
        <SelectItem value="nofail">{AUDIT_ITEMS.nofail}</SelectItem>
      </SelectContent>
    </Select>
  );
}

function MinInstallsSelect({
  surface,
  className,
}: {
  surface: ControlSurface;
  className?: string;
}) {
  const { minInstalls, setParams } = useExplorerState();
  const { selectAlign, selectModal, popupLevel, triggerVariant } =
    surfaceProps(surface);
  return (
    <Select
      value={minInstalls !== null ? String(minInstalls) : ANY}
      onValueChange={(v) => {
        if (v) setParams({ minInstalls: parseMinInstalls(v) });
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
            {minInstallLabel(n)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The composer chin's filter cluster (desktop): result-narrowing filters only
 * — the sort and the Official/descriptions toggles live up in the input row
 * (they're the high-frequency one-click controls; the chin keeps the heavier
 * pickers). Publisher + Audit stay visible; minimum-installs / hide-broken sit
 * behind "More" (badge shows how many of those are active). Clear resets
 * exactly the chin's own filters (`filterCount.chin`).
 */
export function CatalogControlsBar() {
  const {
    publisher,
    setParams,
    minInstalls,
    broken,
    hideGitHubOnly,
    filterCount,
    clearFilters,
  } = useExplorerState();
  const moreCount = filterCount.more;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <PublisherSelect
        value={publisher}
        onChange={(v) => setParams({ publisher: v })}
        surface="chin"
      />
      <AuditSelect surface="chin" />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              aria-label="More filters"
              leadingIcon={
                <HugeiconsIcon
                  icon={FilterHorizontalIcon}
                  strokeWidth={2}
                  className="size-3.5"
                />
              }
              trailingIcon={
                moreCount > 0 ? <FilterCountBadge count={moreCount} /> : null
              }
            />
          }
        >
          More
        </DropdownMenuTrigger>
        {/* Start-aligned, not end-, because this trigger resizes underneath its
            own open menu: setting a filter stamps a count badge onto it. The
            badge grows the trigger rightward — Clear renders after it, so
            nothing pushes back — which leaves the LEFT edge fixed and the right
            edge moving. An end-aligned popup follows the edge that moves, and
            repositions at the one moment the toggle's own work (a cold query,
            then swapping the result list) owns the main thread, so the
            positioner's tween on top/left/right/bottom gets starved and the
            shift stutters. Anchored to the fixed edge there is no reposition to
            starve. */}
        <DropdownMenuContent
          side="bottom"
          align="start"
          level={5}
          className="min-w-56"
        >
          <DropdownMenuLabel>Minimum installs</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={minInstalls !== null ? String(minInstalls) : ANY}
            onValueChange={(v) =>
              setParams({ minInstalls: parseMinInstalls(v) })
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
                {minInstallLabel(n)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>

          <DropdownMenuSeparator />

          {/* Switch indicators, not checkmarks: the mobile sheet renders these
              same two filters as <SwitchRow>, and both surfaces take their
              appearance from FILTER_SWITCH — shape shared, motion deliberately
              split, see the reason there. Visual only: the row keeps its
              `menuitemcheckbox` role and the switch is never focusable. */}
          <DropdownMenuCheckboxItem
            indicator="switch"
            switchShape={FILTER_SWITCH.shape}
            switchMotion={FILTER_SWITCH.menuMotion}
            checked={broken}
            onCheckedChange={(checked) => setParams({ broken: !!checked })}
            closeOnClick={false}
          >
            Hide broken installs
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            indicator="switch"
            switchShape={FILTER_SWITCH.shape}
            switchMotion={FILTER_SWITCH.menuMotion}
            checked={hideGitHubOnly}
            onCheckedChange={(checked) =>
              setParams({ hideGitHubOnly: !!checked })
            }
            closeOnClick={false}
          >
            Hide GitHub-only skills
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {filterCount.chin > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={clearFilters}
          leadingIcon={
            <HugeiconsIcon
              icon={Cancel01Icon}
              strokeWidth={2}
              className="size-3.5"
            />
          }
        >
          Clear ({filterCount.chin})
        </Button>
      )}
    </div>
  );
}

/**
 * The mobile drawer's controls: every control full-width and stacked, so the
 * whole thing is reachable one-handed. No Clear here — it lives in the sheet's
 * header (SkillComposer), so its appearance never shifts this content.
 *
 * Two groups, so the header's Clear has a legible scope (desktop gets this for
 * free — filters sit in the chin next to Clear, while Sort + Search
 * descriptions live elsewhere). Sort (reorders) and Search descriptions
 * (widens matching) don't narrow results, so Clear leaves them alone; grouping
 * them apart from the "Filters" section is what makes that non-obvious rule
 * obvious. The filters below — Official included — all narrow, so Clear resets
 * them together (`filterCount.sheet`).
 */
export function CatalogControlsSheet() {
  const {
    publisher,
    official,
    searchDescriptions,
    broken,
    hideGitHubOnly,
    setParams,
  } = useExplorerState();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4">
        <Field label="Sort by">
          <SortSelect surface="sheet" className="w-full" />
        </Field>
        <SwitchRow
          label="Search descriptions"
          hint="Match on description text, not just names"
          checked={searchDescriptions}
          onCheckedChange={(v) => setParams({ searchDescriptions: v })}
        />
      </div>

      <LabeledSection label="Filters">
        <div className="flex flex-col gap-4">
          <Field label="Publisher">
            <PublisherSelect
              value={publisher}
              onChange={(v) => setParams({ publisher: v })}
              surface="sheet"
              className="w-full"
            />
          </Field>
          <Field label="Security">
            <AuditSelect surface="sheet" className="w-full" />
          </Field>
          <Field label="Minimum installs">
            <MinInstallsSelect surface="sheet" className="w-full" />
          </Field>

          <SwitchRow
            label="Official skills only"
            hint="Only skills from verified publishers"
            checked={official}
            onCheckedChange={(v) => setParams({ official: v })}
          />
          <SwitchRow
            label="Hide broken installs"
            hint="Skip skills whose install command may fail"
            checked={broken}
            onCheckedChange={(v) => setParams({ broken: v })}
          />
          <SwitchRow
            label="Hide GitHub-only skills"
            hint="Only skills available through the skills.sh API"
            checked={hideGitHubOnly}
            onCheckedChange={(v) => setParams({ hideGitHubOnly: v })}
          />
        </div>
      </LabeledSection>
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
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span className="flex flex-col">
        <span className="text-sm">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
      <Switch
        shape={FILTER_SWITCH.shape}
        motion={FILTER_SWITCH.sheetMotion}
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </label>
  );
}
