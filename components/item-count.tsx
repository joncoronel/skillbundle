import { formatInstalls } from "@/lib/utils";

/**
 * Right-aligned count column for select/combobox option rows (facet counts,
 * publisher skill counts). A leaf module so catalog-controls and
 * publisher-select can both use it without importing each other.
 */
export function ItemCount({ count }: { count: number | undefined }) {
  if (count === undefined) return null;
  return (
    <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">
      {formatInstalls(count)}
    </span>
  );
}
