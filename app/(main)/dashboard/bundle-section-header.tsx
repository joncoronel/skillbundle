"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/cubby-ui/select";

export type SortBy = "newest" | "most-copied" | "alphabetical";

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "most-copied", label: "Most copied" },
  { value: "alphabetical", label: "A–Z" },
];

interface BundleSectionHeaderProps {
  count: number;
  sortBy: SortBy;
  onSortChange: (value: SortBy) => void;
}

export function BundleSectionHeader({
  count,
  sortBy,
  onSortChange,
}: BundleSectionHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="font-display text-2xl font-semibold tracking-tight leading-tight text-balance">
        Bundles
        <span className="ml-2 font-normal text-muted-foreground tabular-nums">
          · {count}
        </span>
      </h2>
      <div className="flex items-center gap-2">
        <label
          htmlFor="bundle-sort"
          className="text-sm text-muted-foreground"
        >
          Sort
        </label>
        <Select
          items={SORT_OPTIONS}
          value={sortBy}
          onValueChange={(value) => {
            if (value) onSortChange(value as SortBy);
          }}
        >
          <SelectTrigger
            id="bundle-sort"
            size="sm"
            className="w-auto min-w-36 border-transparent bg-transparent shadow-none before:hidden dark:bg-transparent"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent size="sm" alignItemWithTrigger>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
