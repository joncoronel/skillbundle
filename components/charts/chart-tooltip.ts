// Tooltip geometry. The panel itself lives in `chart-hover-overlay`, with the
// rest of the cursor, and wears the tooltip component's `chrome` surface.

/**
 * Distance the panel is held off the cursor.
 *
 * The panel sits at `x + offset`, flipping to `x - offset - width` only when
 * that would run past the chart — never anything in between, which is what
 * keeps it clear of the marker. Carried over from the old chart's `TooltipBox`.
 */
export const TOOLTIP_OFFSET = 16;
