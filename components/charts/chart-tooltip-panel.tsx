import { pointForMarker, type HoverMarker } from "./chart-hover-overlay";

/**
 * Builds the panel's rows: one per marker that has a point at this x, in marker
 * order, with the value the chart formats.
 *
 * The charts differ only in that formatter, so it is the only thing they pass.
 */
export function tooltipRows<T extends { group?: unknown; markId?: unknown }>(
  markers: readonly HoverMarker[],
  points: readonly T[],
  format: (point: T, marker: HoverMarker) => string,
) {
  return markers.flatMap((marker) => {
    const point = pointForMarker(points, marker);
    return point ? [{ marker, value: format(point, marker) }] : [];
  });
}

/**
 * The hover panel's contents, rendered by the library's tooltip extension
 * through `renderTooltipBody`.
 *
 * The extension owns where this sits and when it appears; this owns what it
 * says and how it looks. Its surface is the tooltip component's `chrome`
 * variant — `bg-chrome` plus `data-surface="chrome"`, which re-points
 * --foreground / --muted-foreground onto that near-black fill so the row labels
 * read against it. Fill only: `--chrome-shadow` is the variant's opt-in edge,
 * for a header bar rather than a label.
 *
 * `rounded-lg` (12px) is the old chart's radius, not the variant's `rounded-sm`
 * (8px): this is a two-row data panel about 190px wide, not the one-line label
 * that variant is sized for.
 */
export function ChartTooltipPanel({
  title,
  rows,
}: {
  title: string;
  rows: readonly { marker: HoverMarker; value: string }[];
}) {
  return (
    <div
      className="min-w-[9rem] overflow-hidden rounded-lg bg-chrome px-3 py-2.5 text-foreground"
      data-surface="chrome"
      // Capped so a long skill name cannot stretch it across the plot.
      style={{ maxWidth: "min(16rem, calc(50vw - 3.5rem))" }}
    >
      <div className="mb-2 text-xs font-medium">{title}</div>
      <div className="space-y-1.5">
        {rows.map(({ marker, value }) => (
          <div
            className="flex items-center justify-between gap-4"
            key={marker.key}
          >
            {/* The label gives way, not the number: a long skill name
                ellipsizes rather than wrapping and squeezing the value it is
                labelling out of the panel. */}
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: marker.swatch ?? marker.color }}
              />
              <span className="truncate text-sm text-muted-foreground">
                {marker.label}
              </span>
            </div>
            <span className="shrink-0 text-sm font-medium tabular-nums">
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
