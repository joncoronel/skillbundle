"use client";

import { useEffect, useMemo } from "react";
import { Line } from "@/components/charts/line";
import { LineChart } from "@/components/charts/line-chart";
import { ChartTooltip } from "@/components/charts/tooltip";
import { useChart } from "@/components/charts/chart-context";
import {
  CHART_VARS,
  type SkillInsights,
  type SparklineHoverState,
} from "@/components/skill-chart-shared";

/**
 * Compact cumulative-installs sparkline for the sidebar: bklit's line, keeping its
 * spring dot and the hover dim/highlight, scaled so the slope is actually visible.
 * The chart's y-domain is zero-based, and a cumulative count in the hundreds of
 * thousands moves only a few percent over a week — plotting the absolute total
 * pins the line flat at the top. So we plot each point's installs ABOVE the window
 * minimum instead, which makes the domain span the real variation; the hover
 * bridge still reads the untouched `installs` field, so the sidebar scrubs the
 * true total.
 *
 * This is the only chart above the fold on the skill page, so it ships eager —
 * just the lightweight `LineChart`. The heavier dialog chart lives in its own
 * file (skill-install-chart) so it doesn't ride along in this bundle.
 */
export function InstallSparkline({
  points,
  onHover,
}: {
  points: SkillInsights["snapshots"];
  onHover?: (state: SparklineHoverState) => void;
}) {
  const data = useMemo(() => {
    const min = points.length ? Math.min(...points.map((p) => p.installs)) : 0;
    // `plot` = installs above the window floor: it drives the zero-based domain
    // so the line isn't flat. `installs` stays intact for the hover bridge.
    return points.map((p) => ({
      date: p.day,
      installs: p.installs,
      plot: p.installs - min,
    }));
  }, [points]);

  return (
    <div style={CHART_VARS}>
      <LineChart
        data={data}
        xDataKey="date"
        aspectRatio="7 / 1"
        animationDuration={0}
        margin={{ top: 4, right: 3, bottom: 4, left: 3 }}
        // The hover dot sits on the first/last point, which sit at the plot edges;
        // with margins this small the dot is wider than the margin, so the SVG's
        // default overflow:hidden shears it. Let the chart SVG overflow instead —
        // it keeps the line full-width (no inset) and only the dot spills, by a
        // few px, into the surrounding gutter.
        className="[&_svg]:overflow-visible"
      >
        <Line
          dataKey="plot"
          stroke="var(--primary)"
          strokeWidth={1.5}
          fadeEdges={false}
          animate={false}
        />
        {onHover && (
          <>
            {/* Box hidden (no popover over a 40px chart) and crosshair off, but
                the spring dot + line dim/highlight that ride along with the
                tooltip stay. The value is surfaced via the hover bridge. */}
            <ChartTooltip
              showCrosshair={false}
              showDatePill={false}
              panelStyle={{ display: "none" }}
            />
            <SparklineHoverBridge onHover={onHover} />
          </>
        )}
      </LineChart>
    </div>
  );
}

/** Pipes the hovered point's true total + day off the chart's interaction state. */
function SparklineHoverBridge({
  onHover,
}: {
  onHover: (state: SparklineHoverState) => void;
}) {
  const { tooltipData } = useChart();
  const point = tooltipData?.point;
  const value = typeof point?.installs === "number" ? point.installs : null;
  const day = typeof point?.date === "string" ? point.date : null;
  // Depend on the primitives, not the `tooltipData` object — its identity
  // changes every render, which would re-fire `onHover` (and the parent's
  // setState) in a loop.
  useEffect(() => {
    onHover(value != null && day != null ? { value, day } : null);
  }, [value, day, onHover]);
  return null;
}

/**
 * Faint placeholder for the sparkline before there's enough history: a ghost
 * trend line dissolving into the unrecorded future. No data, just a stand-in
 * for where the trend will live.
 */
export function InstallSparklineGhost() {
  return (
    <svg
      viewBox="0 0 120 32"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="h-10 w-full text-muted-foreground/45 mask-[linear-gradient(to_right,#000,#000_30%,transparent)]"
    >
      <path
        d="M0 25 C 18 23 30 18 46 17 C 62 16 78 11 96 8 C 108 5 114 5 120 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
