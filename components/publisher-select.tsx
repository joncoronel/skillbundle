"use client";

import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { useAsyncCombobox } from "@/components/ui/cubby-ui/combobox/hooks/use-async-combobox";
import { Button } from "@/components/ui/cubby-ui/button";
import { DotMatrixRipple } from "@/components/ui/dot-matrix-ripple";
import { ItemCount } from "@/components/item-count";
import { listOwners, type OwnerCount } from "@/lib/search/typesense";
import { SEARCH_DEBOUNCE_MS } from "@/lib/search-params";
import { cn } from "@/lib/utils";

/** A publisher row for the async picker (`id` = the owner slug). */
type OwnerItem = { id: string; count: number };

// The debounce runs *inside* searchFn (so the hook's `isPending` covers it —
// no gap for a false "no match" flash, and no loading state shorter than the
// debounce itself). Loading UI is fully derived from isPending: fast/cached
// responses show results instantly with no artificial floor.
const OWNERS_STALE_MS = 5 * 60_000;

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
export function PublisherSelect({
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

  // Facet search as the user types, with the debounce + React Query caching
  // folded into one searchFn:
  //   1. a fresh cache hit returns instantly — RQ's speed win, no spinner;
  //   2. otherwise debounce (abortable, so rapid keystrokes cancel it),
  //   3. fetch through RQ (cache + dedup).
  // Because the wait runs inside searchFn, the hook's `isPending` covers it,
  // so there's never a window where the list is empty and "pending" is false.
  const searchFn = useCallback(
    async (query: string, signal: AbortSignal): Promise<OwnerItem[]> => {
      const key = ["typesense-owners", query] as const;
      const cached = queryClient.getQueryState<OwnerCount[]>(key);
      if (cached?.data && Date.now() - cached.dataUpdatedAt < OWNERS_STALE_MS) {
        return cached.data.map(toItem);
      }

      await sleep(SEARCH_DEBOUNCE_MS, signal);
      const owners = await queryClient.fetchQuery({
        queryKey: key,
        queryFn: ({ signal: s }) => listOwners({ query, signal: s }),
        staleTime: OWNERS_STALE_MS,
      });
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

  // Cache-aware retypes, derived at render (same contract as the catalog
  // search's cache bypass). The hook's isPending flips true the moment ANY
  // search starts — its transition can't tell "resolved from cache in a
  // microtask" from "fetching" — and its internal items only update when the
  // transition commits, a couple frames later. So for queries whose results
  // are already cached, BOTH halves derive from the cache synchronously:
  //  - `showLoading` false — no spinner/dim/"Searching…" flash;
  //  - `displayItems` renders the cached results on the very first frame, so
  //    the stale/empty internal list never shows (no blank flash).
  // A stale entry gets the same treatment: searchFn revalidates in the
  // background while the cached rows hold — never spin over real results.
  const cachedOwners = query.length
    ? queryClient.getQueryData<OwnerCount[]>(["typesense-owners", query])
    : undefined;
  const showLoading = isPending && cachedOwners === undefined;

  const displayItems = useMemo(() => {
    if (!isPending || cachedOwners === undefined) return items;
    // Mirror the hook's merge: selected publishers stay visible in the list.
    const cached = cachedOwners.map(toItem);
    const cachedIds = new Set(cached.map((o) => o.id));
    return [...cached, ...selected.filter((s) => !cachedIds.has(s.id))];
  }, [isPending, cachedOwners, items, selected]);

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
    if (showLoading && displayItems.length === 0) return "Searching…";
    if (query === "") {
      return value.length === 0 ? "Type to find a publisher…" : null;
    }
    // "No match" needs a KNOWN answer: the search settled, or the cache
    // already holds this query's (empty) result — an uncached in-flight
    // search must not flash a false "no match".
    if ((!isPending || cachedOwners !== undefined) && displayItems.length === 0)
      return `No publishers match “${query}”.`;
    return null;
  };

  return (
    <Combobox<OwnerItem, true>
      multiple
      items={displayItems}
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
            showLoading && displayItems.length > 0 && "opacity-50",
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
