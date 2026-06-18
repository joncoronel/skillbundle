"use client";

import { useMemo } from "react";
import { ComposedChart } from "@/components/charts/composed-chart";
import { SeriesBar } from "@/components/charts/series-bar";
import { Line } from "@/components/charts/line";
import { Grid } from "@/components/charts/grid";
import { XAxis } from "@/components/charts/x-axis";
import { ChartTooltip } from "@/components/charts/tooltip";
import {
  CHART_VARS,
  intFmt,
  seriesSummary,
  toDate,
  type SkillInsights,
} from "@/components/skill-chart-shared";

// The install dialog chart sits at surface-5, so a surface-3 tooltip wouldn't
// separate from it (in light mode both are pure white) — there the tooltip
// rides one tier above the dialog at surface-7, the cubby convention for a
// popover nested in a dialog. Glass blur off.
const TOOLTIP_PANEL_STYLE: React.CSSProperties = {
  background: "var(--surface-7)",
  color: "var(--popover-foreground)",
  boxShadow: "var(--surface-shadow-7), var(--surface-rim-7)",
  backdropFilter: "none",
};

// Daily bars are the secondary series: the design system's neutral fill,
// softened so the Signal Blue total line stays the one accent.
const BAR_FILL = "color-mix(in oklch, var(--neutral) 65%, transparent)";

/**
 * The full install history: cumulative total (line, right axis) + daily gained
 * (bars, default axis) on independent scales. Lives in the chart dialog where it
 * has room; the sidebar shows the sparkline and opens this on demand.
 *
 * Kept in its own file (the heavy ComposedChart + bar path) so it only ships to
 * the skill page, never the compare page — and so it can be swapped to
 * `next/dynamic` later, loading on dialog-open, without touching the sparkline.
 */
export function InstallChart({ insights }: { insights: SkillInsights }) {
  const { snapshots } = insights;

  // One row per day: `total` (cumulative, the line) and `daily` (gained, the
  // bars). Day-over-day can dip negative on a correction; floor at 0.
  const series = useMemo(
    () =>
      snapshots.map((s, i) => ({
        // A Date (pinned to UTC noon) rather than the raw "YYYY-MM-DD" string:
        // the chart parses bare strings as UTC midnight, which formats a day
        // early west of UTC. See toDate.
        date: toDate(s.day),
        total: s.installs,
        daily:
          i === 0 ? 0 : Math.max(0, s.installs - snapshots[i - 1].installs),
      })),
    [snapshots],
  );

  return (
    <div>
      <Legend />
      <div
        style={CHART_VARS}
        role="img"
        aria-label={`Install history: ${seriesSummary(snapshots)}.`}
      >
        <ComposedChart
          data={series}
          xDataKey="date"
          aspectRatio="5 / 2"
          maxBarSize={26}
          animationDuration={0}
          margin={{ top: 16, right: 14, bottom: 30, left: 14 }}
        >
          <Grid horizontal />
          {/* Bars on the default axis (daily, ~0–20), line on its own right
              axis (cumulative, hundreds) so each scales to fit. */}
          <SeriesBar
            animate={false}
            dataKey="daily"
            fill={BAR_FILL}
            radius={4}
          />
          <Line
            animate={false}
            dataKey="total"
            stroke="var(--primary)"
            strokeWidth={2}
            yAxisId="right"
          />
          {/* "data" mode pins one label per data row at its x position. With a
              short, sparse series the default "domain" mode spreads ticks across
              the time range and they drift off the actual points/bars. */}
          <XAxis tickMode="data" />
          <ChartTooltip
            panelStyle={TOOLTIP_PANEL_STYLE}
            rows={(point) => [
              {
                color: "var(--primary)",
                label: "Total installs",
                value: point.total as number,
              },
              {
                color: BAR_FILL,
                label: "Daily installs",
                value: `+${intFmt(point.daily as number)}`,
              },
            ]}
          />
        </ComposedChart>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1.5">
      <LegendItem label="Total installs">
        <span
          className="h-0.5 w-4 rounded-full"
          style={{ background: "var(--primary)" }}
        />
      </LegendItem>
      <LegendItem label="Daily installs">
        <span
          className="size-2.5 rounded-[3px]"
          style={{ background: BAR_FILL }}
        />
      </LegendItem>
    </div>
  );
}

function LegendItem({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span aria-hidden="true" className="flex w-4 justify-center">
        {children}
      </span>
      {label}
    </span>
  );
}
