"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
} from "@/components/ui/cubby-ui/combobox/combobox";
import { ItemCount } from "@/components/item-count";
import {
  FilterPickerClear,
  FilterPickerSearch,
  FilterPickerTrigger,
} from "@/components/filter-picker";
import type { ControlSurface } from "@/components/catalog-controls";
import {
  CATEGORY_KEYS,
  CATEGORY_LABELS,
  type CategoryKey,
} from "@/convex/lib/categories";
import { listCategoryCounts } from "@/lib/search/typesense";

type CategoryItem = { id: CategoryKey; label: string };

const ITEMS: CategoryItem[] = CATEGORY_KEYS.map((id) => ({
  id,
  label: CATEGORY_LABELS[id],
}));

// Counts move once a day (the catalog sync), so an hour is plenty.
const COUNTS_STALE_MS = 60 * 60_000;

/**
 * Category filter, any-of. The same combobox and shared pieces
 * (`filter-picker.tsx`) as PublisherSelect, so the two pickers side by side
 * behave alike, but the list is the fixed 22 categories
 * and the input filters them locally: there is nothing to fetch per keystroke.
 * Listed in definition order (related categories sit together) rather than by
 * count, so the list never reshuffles when the counts arrive.
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
  // Counts are fetched on first open only, so the home page doesn't spend a
  // Typesense request per visit on a picker most visitors never open.
  const [opened, setOpened] = useState(false);
  const counts = useQuery({
    queryKey: ["typesense-category-counts"],
    queryFn: ({ signal }) => listCategoryCounts({ signal }),
    enabled: opened,
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
      // Kept in definition order whatever order they were checked in, so the
      // URL for a given selection is always the same.
      onValueChange={(next: CategoryItem[]) =>
        onChange(
          CATEGORY_KEYS.filter((key) => next.some((item) => item.id === key)),
        )
      }
      isItemEqualToValue={(a: CategoryItem, b: CategoryItem) => a.id === b.id}
      itemToStringLabel={(item: CategoryItem) => item.label}
      inputValue={inputValue}
      onInputValueChange={(next: string) => setInputValue(next)}
      onOpenChange={(open: boolean) => {
        if (open) setOpened(true);
      }}
      onOpenChangeComplete={(open: boolean) => {
        // Reset the search on close (the trigger label carries the selection).
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
      <ComboboxPopup
        level={inSheet ? 7 : 5}
        align="start"
        // Fits the longest row ("Browser automation & scraping", its count and
        // the check) so no category name is ever cut off.
        className="flex min-w-80 flex-col p-0"
      >
        <FilterPickerSearch placeholder="Search categories…" />
        <ComboboxEmpty>
          No categories match “{inputValue.trim()}”.
        </ComboboxEmpty>
        <ComboboxList>
          {(item: CategoryItem) => (
            <ComboboxItem key={item.id} value={item}>
              {/* The item wraps children in a plain block, so the row needs
                  its own flex for ItemCount's ml-auto to right-align. */}
              <span className="flex items-center">
                <span className="whitespace-nowrap">{item.label}</span>
                <ItemCount count={counts.data?.[item.id]} />
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
        {value.length > 0 ? (
          <FilterPickerClear onClick={() => onChange([])}>
            Clear categories
          </FilterPickerClear>
        ) : null}
      </ComboboxPopup>
    </Combobox>
  );
}
