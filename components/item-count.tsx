import { formatInstalls } from "@/lib/utils";

/**
 * Right-aligned count column for select/combobox option rows (facet counts,
 * publisher skill counts). A leaf module so catalog-controls and
 * publisher-select can both use it without importing each other.
 */
export function ItemCount({ count }: { count: number | undefined }) {
  if (count === undefined) return null;
  return (
    // shrink-0: beside a wrapping label, the count would squeeze into a
    // column of single digits.
    <span className="ml-auto shrink-0 pl-3 text-xs text-muted-foreground tabular-nums">
      {formatInstalls(count)}
    </span>
  );
}
