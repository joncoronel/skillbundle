"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/components/ui/cubby-ui/combobox/combobox";
import { ItemCount } from "@/components/item-count";
import {
  FilterPickerClear,
  FilterPickerPopup,
  FilterPickerSearch,
  FilterPickerTrigger,
  PICKER_ITEM_COLUMNS,
} from "@/components/filter-picker";
import type { ControlSurface } from "@/components/catalog-controls";
import {
  CATEGORY_KEYS,
  CATEGORY_LABELS,
  type CategoryKey,
} from "@/convex/lib/categories";
import { useFacetScope } from "@/components/explorer-state";
import { listFacetCounts } from "@/lib/search/typesense";

type CategoryItem = { id: CategoryKey; label: string };

const ITEMS: CategoryItem[] = CATEGORY_KEYS.map((id) => ({
  id,
  label: CATEGORY_LABELS[id],
}));

// A scope's counts change once a day with the catalog sync.
const COUNTS_STALE_MS = 60 * 60_000;

/**
 * Category filter, any-of, built from the same pieces as PublisherSelect but
 * filtered locally. Definition order, not count order, so the list doesn't
 * reshuffle when counts arrive.
 */
export function CategorySelect({
  value,
  onChange,
  className,
  surface,
}: {
  value: CategoryKey[];
  onChange: (v: CategoryKey[]) => void;
  className?: string;
  surface: ControlSurface;
}) {
  const inSheet = surface === "sheet";
  const [inputValue, setInputValue] = useState("");
  // Counts cover the current search, and are fetched only while open.
  const [open, setOpen] = useState(false);
  const { scope, facetField } = useFacetScope("categories");
  const counts = useQuery({
    queryKey: ["typesense-category-counts", scope],
    queryFn: async ({ signal }) =>
      Object.fromEntries(
        (await listFacetCounts(facetField, { scope, signal })).map((c) => [
          c.value,
          c.count,
        ]),
      ),
    enabled: open,
    staleTime: COUNTS_STALE_MS,
    gcTime: COUNTS_STALE_MS,
  });

  const selected = useMemo(
    () => ITEMS.filter((item) => value.includes(item.id)),
    [value],
  );

  const selectionLabel =
    value.length === 0
      ? null
      : value.length === 1
        ? CATEGORY_LABELS[value[0]]
        : `${value.length} categories`;

  return (
    <Combobox<CategoryItem, true>
      multiple
      items={ITEMS}
      value={selected}
      // Definition order, so a given selection always gives the same URL.
      onValueChange={(next: CategoryItem[]) =>
        onChange(
          CATEGORY_KEYS.filter((key) => next.some((item) => item.id === key)),
        )
      }
      isItemEqualToValue={(a: CategoryItem, b: CategoryItem) => a.id === b.id}
      itemToStringLabel={(item: CategoryItem) => item.label}
      inputValue={inputValue}
      onInputValueChange={(next: string) => setInputValue(next)}
      onOpenChange={setOpen}
      onOpenChangeComplete={(open: boolean) => {
        if (!open) setInputValue("");
      }}
      modal={inSheet ? false : undefined}
    >
      <ComboboxTrigger
        render={(triggerProps: React.ComponentProps<"button">) => (
          <FilterPickerTrigger
            triggerProps={triggerProps}
            name="Category"
            selectionLabel={selectionLabel}
            inSheet={inSheet}
            className={className}
          />
        )}
      />
      <FilterPickerPopup inSheet={inSheet}>
        <FilterPickerSearch placeholder="Search categories…" />
        <ComboboxEmpty>
          No categories match “{inputValue.trim()}”.
        </ComboboxEmpty>
        <ComboboxList>
          {(item: CategoryItem) => (
            <ComboboxItem
              key={item.id}
              value={item}
              className={PICKER_ITEM_COLUMNS}
            >
              <span className="flex items-center">
                <span className="whitespace-nowrap">{item.label}</span>
                {/* Absent from the facet = no matching skills. */}
                <ItemCount
                  count={counts.data ? (counts.data[item.id] ?? 0) : undefined}
                />
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
        {value.length > 0 ? (
          <FilterPickerClear onClick={() => onChange([])}>
            Clear categories
          </FilterPickerClear>
        ) : null}
      </FilterPickerPopup>
    </Combobox>
  );
}
