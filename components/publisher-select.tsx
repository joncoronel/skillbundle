"use client";

import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  Search01Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";
import {
  Combobox,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxStatus,
  ComboboxTrigger,
} from "@/components/ui/cubby-ui/combobox/combobox";
import { Button } from "@/components/ui/cubby-ui/button";
import { DotMatrixRipple } from "@/components/ui/dot-matrix-ripple";
import { ItemCount } from "@/components/item-count";
import type { ControlSurface } from "@/components/catalog-controls";
import {
  deriveInputLoading,
  useDebouncedQueryValue,
} from "@/hooks/use-debounced-query-value";
import { listOwners, type OwnerCount } from "@/lib/search/typesense";
import { cn } from "@/lib/utils";

/** A publisher row for the picker (`id` = the owner slug). */
type OwnerItem = { id: string; count: number };

const OWNERS_STALE_MS = 5 * 60_000;

const ownersQueryKey = (query: string) => ["typesense-owners", query] as const;

const toItem = (o: OwnerCount): OwnerItem => ({ id: o.value, count: o.count });

/**
 * Publisher (owner) filter — a type-to-search combobox driven by the SAME
 * debounce + cache-bypass primitive as every other search input
 * (useDebouncedQueryValue → React Query → deriveInputLoading): cached retypes
 * render on the first frame with zero loading UI, uncached queries debounce
 * then fetch with the previous rows dimmed (keepPreviousData), and superseded
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

  const effectiveQuery = useDebouncedQueryValue(inputValue, (t) =>
    ownersQueryKey(t),
  );

  const ownersQuery = useQuery({
    queryKey: ownersQueryKey(effectiveQuery),
    queryFn: ({ signal }) => listOwners({ query: effectiveQuery, signal }),
    enabled: effectiveQuery.length > 0,
    // Keep the previous query's rows (dimmed) while a refinement fetches, so
    // the list never flashes empty between keystrokes.
    placeholderData: keepPreviousData,
    staleTime: OWNERS_STALE_MS,
    gcTime: OWNERS_STALE_MS,
  });

  const showLoading = deriveInputLoading(trimmed, effectiveQuery, ownersQuery);

  // Selected items (id = slug), stable while the value's contents are
  // unchanged so the merge below doesn't churn every render.
  const valueKey = value.join(",");
  const selected = useMemo<OwnerItem[]>(
    () => value.map((v) => ({ id: v, count: 0 })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [valueKey],
  );

  // Results merged with the current selection, so selected publishers stay
  // visible (checkable) even when they don't match the query.
  const results = ownersQuery.data;
  const items = useMemo(() => {
    const matched = trimmed.length > 0 ? (results ?? []).map(toItem) : [];
    const matchedIds = new Set(matched.map((o) => o.id));
    return [...matched, ...selected.filter((s) => !matchedIds.has(s.id))];
  }, [trimmed.length, results, selected]);

  const label =
    value.length === 0
      ? "Publisher"
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
      return `No publishers match “${trimmed}”.`;
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
            aria-busy={showLoading}
            start={
              <HugeiconsIcon
                icon={Search01Icon}
                strokeWidth={2}
                className="text-muted-foreground"
              />
            }
            end={
              showLoading ? (
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
            showLoading && items.length > 0 && "opacity-50",
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
