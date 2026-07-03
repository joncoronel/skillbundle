"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  FilterHorizontalIcon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
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
import { formatInstalls } from "@/lib/utils";
import type { FacetCount } from "@/lib/search/typesense";
import type {
  AuditFilterValue,
  CatalogSortValue,
} from "@/lib/search-params";

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
  /** true = forks/copies are INCLUDED (catalog hides them by default). */
  forks: boolean;
  onForksChange: (v: boolean) => void;
  /** true = skills with failing SKILL.md fetches are hidden. */
  broken: boolean;
  onBrokenChange: (v: boolean) => void;
  /** Reset every filter (not the sort) back to its broad default. */
  onClearFilters: () => void;
  /** Facet counts from the current result set (active state only). */
  facets?: Record<string, FacetCount[]>;
}

const SORT_LABELS: Record<CatalogSortValue, string> = {
  relevance: "Relevance",
  installs: "Most installed",
};

// Sentinel for "no narrowing" select/radio items — Base UI needs a non-null
// value, so the broad default gets an explicit one.
const ANY = "any";

const MIN_INSTALL_PRESETS = [100, 1_000, 10_000] as const;

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
 * The catalog's sort + filter bar. The two differentiator filters — Official
 * and Audit — stay visible as scoped selects (each defaulting to its broadest
 * value, so active narrowing is always readable in the closed trigger).
 * Secondary hygiene filters (minimum installs, forks, broken) live behind
 * "More" so the bar doesn't sprawl; its badge shows how many are active.
 * "Clear (n)" resets every filter (the sort is a view preference, kept).
 *
 * Rendered in both home states (Popular-tab header + active-state bar).
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
  forks,
  onForksChange,
  broken,
  onBrokenChange,
  onClearFilters,
  facets,
}: CatalogControlsProps) {
  const officialCount = facetCount(facets, "isOfficial", "true");
  const passCount = facetCount(facets, "worstAuditStatus", "pass");

  const moreCount =
    (minInstalls !== null ? 1 : 0) + (forks ? 1 : 0) + (broken ? 1 : 0);
  const activeFilterCount =
    (official ? 1 : 0) + (audit ? 1 : 0) + moreCount;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Select
        value={sort}
        onValueChange={(v) => {
          if (v) onSortChange(v as CatalogSortValue);
        }}
        items={SORT_LABELS}
      >
        <SelectTrigger size="sm" aria-label="Sort catalog">
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger>
          <SelectItem value="relevance" disabled={!hasQuery}>
            Relevance
          </SelectItem>
          <SelectItem value="installs">Most installed</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={official ? "official" : ANY}
        onValueChange={(v) => {
          if (v) onOfficialChange(v === "official");
        }}
        items={{ [ANY]: "All skills", official: "Official only" }}
      >
        <SelectTrigger size="sm" aria-label="Filter by publisher type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger>
          <SelectItem value={ANY}>All skills</SelectItem>
          <SelectItem value="official">
            Official only
            <ItemCount count={officialCount} />
          </SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={audit ?? ANY}
        onValueChange={(v) => {
          if (v) onAuditChange(v === ANY ? null : (v as AuditFilterValue));
        }}
        items={{ [ANY]: "Any audit", pass: "Passed audit" }}
      >
        <SelectTrigger size="sm" aria-label="Filter by security audit">
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger>
          <SelectItem value={ANY}>Any audit</SelectItem>
          <SelectItem value="pass">
            Passed audit
            <ItemCount count={passCount} />
          </SelectItem>
        </SelectContent>
      </Select>

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
                moreCount > 0 ? (
                  <span className="flex size-4.5 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground tabular-nums">
                    {moreCount}
                  </span>
                ) : undefined
              }
            />
          }
        >
          More
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" className="min-w-56">
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
            checked={forks}
            onCheckedChange={(checked) => onForksChange(!!checked)}
            closeOnClick={false}
          >
            Show forks & copies
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

      {activeFilterCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
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
      )}
    </div>
  );
}
