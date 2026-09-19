"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Combobox,
  ComboboxItem,
  ComboboxList,
  ComboboxStatus,
  ComboboxTrigger,
} from "@/components/ui/cubby-ui/combobox/combobox";
import { Spinner } from "@/components/ui/spinner";
import {
  FilterPickerClear,
  FilterPickerPopup,
  FilterPickerSearch,
  FilterPickerTrigger,
  PICKER_ITEM_COLUMNS,
} from "@/components/filter-picker";
import { ItemCount } from "@/components/item-count";
import type { ControlSurface } from "@/components/catalog-controls";
import {
  deriveInputLoading,
  useDebouncedQueryValue,
} from "@/hooks/use-debounced-query-value";
import { useFacetScope } from "@/components/explorer-state";
import {
  listFacetCounts,
  type FacetCount,
  type FacetScope,
} from "@/lib/search/typesense";
import { cn } from "@/lib/utils";

/** A publisher row for the picker (`id` = the owner slug). */
type OwnerItem = { id: string; count: number };

const OWNERS_STALE_MS = 5 * 60_000;

const ownersQueryKey = (query: string, scope: FacetScope) =>
  ["typesense-owners", query, scope] as const;

const toItem = (o: FacetCount): OwnerItem => ({ id: o.value, count: o.count });

/**
 * Publisher (owner) filter — a type-to-search combobox driven by the SAME
 * debounce + cache-bypass primitive as every other search input
 * (useDebouncedQueryValue → React Query → deriveInputLoading): cached retypes
 * render on the first frame with zero loading UI, uncached queries debounce
 * then fetch with a related search's rows dimmed, and superseded
 * keystrokes abort. Multi-select (any-of); the trigger shows a summary, the
 * popup a checkable list. Type-to-search only — the catalog has too many
 * publishers to browse.
 */
export function PublisherSelect({
  value,
  onChange,
  className,
  surface,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  className?: string;
  surface: ControlSurface;
}) {
  const inSheet = surface === "sheet";
  const [inputValue, setInputValue] = useState("");
  const trimmed = inputValue.trim();

  // Publishers and counts cover the current search, so a publisher with no
  // matching skills isn't offered.
  const { scope, narrowed } = useFacetScope("owners");

  const effectiveQuery = useDebouncedQueryValue(inputValue, (t) =>
    ownersQueryKey(t, scope),
  );

  const ownersQuery = useQuery({
    queryKey: ownersQueryKey(effectiveQuery, scope),
    queryFn: ({ signal }) =>
      listFacetCounts("owner", { scope, facetQuery: effectiveQuery, signal }),
    enabled: effectiveQuery.length > 0,
    // Keep the previous rows (dimmed) only for a related search ("a" → "ab"
    // or back). This observer outlives a cleared input, so plain
    // keepPreviousData showed "a"'s rows under an unrelated "b".
    // `previousQuery` is the last query that had data.
    placeholderData: (previous, previousQuery) => {
      const before = previousQuery?.queryKey[1];
      const related =
        typeof before === "string" &&
        before.length > 0 &&
        effectiveQuery.length > 0 &&
        (effectiveQuery.startsWith(before) ||
          before.startsWith(effectiveQuery));
      return related ? previous : undefined;
    },
    staleTime: OWNERS_STALE_MS,
    gcTime: OWNERS_STALE_MS,
  });

  const showLoading = deriveInputLoading(trimmed, effectiveQuery, ownersQuery);

  // Selected items (id = slug). `value` is the nuqs-parsed publisher array,
  // which is reference-stable across renders while the URL param is unchanged
  // (nuqs caches the parse), so depending on it directly is enough — no
  // join-key + eslint-disable needed.
  const selected = useMemo<OwnerItem[]>(
    () => value.map((v) => ({ id: v, count: 0 })),
    [value],
  );

  // Results merged with the current selection, so selected publishers stay
  // visible (checkable) even when they don't match the query.
  const results = ownersQuery.data;
  const items = useMemo(() => {
    const matched = trimmed.length > 0 ? (results ?? []).map(toItem) : [];
    const matchedIds = new Set(matched.map((o) => o.id));
    return [...matched, ...selected.filter((s) => !matchedIds.has(s.id))];
  }, [trimmed.length, results, selected]);

  const selectionLabel =
    value.length === 0
      ? null
      : value.length === 1
        ? value[0]
        : `${value.length} publishers`;

  // Status text above the list. The spinner itself lives in the input's `end`
  // slot; here we only surface text when there's nothing else to show, so the
  // list is never replaced mid-search. "No match" needs a KNOWN answer — the
  // trimmed query's own results are showing (showLoading false) — so an
  // in-flight search can't flash a false "no match".
  const status = () => {
    if (ownersQuery.error) return "Search failed. Try again.";
    if (showLoading && items.length === 0) return "Searching…";
    if (trimmed === "") {
      return value.length === 0 ? "Type to find a publisher…" : null;
    }
    if (!showLoading && items.length === 0)
      return narrowed
        ? `No publishers match “${trimmed}” in these results.`
        : `No publishers match “${trimmed}”.`;
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
      // Search is server-side (the facet query) — no client-side filtering.
      filter={null}
      inputValue={inputValue}
      onInputValueChange={(next: string) => setInputValue(next)}
      onOpenChangeComplete={(open: boolean) => {
        // Reset the search on close (the chips/summary carry the selection).
        if (!open) setInputValue("");
      }}
      modal={inSheet ? false : undefined}
    >
      <ComboboxTrigger
        render={(triggerProps: React.ComponentProps<"button">) => (
          <FilterPickerTrigger
            triggerProps={triggerProps}
            name="Publisher"
            selectionLabel={selectionLabel}
            inSheet={inSheet}
            className={className}
          />
        )}
      />
      <FilterPickerPopup inSheet={inSheet}>
        <FilterPickerSearch
          placeholder="Search publishers…"
          busy={showLoading}
          end={showLoading ? <Spinner size="xs" /> : null}
        />
        {/* Base UI's Status ships `role="status"` + `aria-live`, and it stays
            mounted for the life of the popup while `status()` varies — so this
            IS the live region for the search. The spinner in the input stays
            decorative rather than announcing the same thing twice. */}
        <ComboboxStatus className="empty:hidden">{status()}</ComboboxStatus>
        {/* Dim (don't replace) stale results while the next query resolves, so
            there's no relayout. Gated on items so a first search doesn't fade
            in from dim. */}
        <ComboboxList
          className={cn(
            "transition-opacity duration-150",
            showLoading && items.length > 0 && "opacity-50",
          )}
        >
          {(o: OwnerItem) => (
            <ComboboxItem key={o.id} value={o} className={PICKER_ITEM_COLUMNS}>
              {/* Long domains wrap: a cut-off publisher has nowhere else to be read. */}
              <span className="flex min-w-0 items-center">
                <span className="min-w-0 break-all">{o.id}</span>
                {o.count > 0 ? <ItemCount count={o.count} /> : null}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
        {value.length > 0 ? (
          <FilterPickerClear onClick={() => onChange([])}>
            Clear publishers
          </FilterPickerClear>
        ) : null}
      </FilterPickerPopup>
    </Combobox>
  );
}
