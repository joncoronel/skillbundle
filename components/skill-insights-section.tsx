"use client";

import { useMemo } from "react";
import { LabeledSection } from "@/components/labeled-section";
import { ComposedChart } from "@/components/charts/composed-chart";
import { SeriesBar } from "@/components/charts/series-bar";
import { Line } from "@/components/charts/line";
import { Grid } from "@/components/charts/grid";
import { XAxis } from "@/components/charts/x-axis";
import { ChartTooltip } from "@/components/charts/tooltip";
import { cn } from "@/lib/utils";

export type SkillInsights = {
  snapshots: { day: string; installs: number }[];
  installs: number;
  installRank: number | null;
  totalSkills: number | null;
  trendingRank: number | null;
  hotChange: number | null;
};

// Days of history needed before the time-series is worth showing. Below this
// the chart is a near-flat couple of points, so we show the "collecting" state
// instead (skills.sh has no history to backfill — the series grows ~1/day).
const MIN_POINTS = 7;

// The bklit charts read their palette from `--chart-*` CSS variables. This
// project's Tailwind v4 build tree-shakes those out of the stylesheet (the
// charts only reference them in runtime SVG, so the compiler sees them as
// unused), so we set them inline on the chart wrapper instead — inline styles
// are never pruned. Mapped to existing app tokens so the chart tracks the
// theme (Signal Blue series, hairline grid) and stays correct in dark mode.
const CHART_VARS = {
  "--chart-1": "var(--primary)",
  "--chart-line-primary": "var(--primary)",
  "--chart-grid": "var(--border)",
  "--chart-crosshair": "var(--primary)",
  "--chart-label": "var(--muted-foreground)",
  "--chart-foreground": "var(--foreground)",
  "--chart-foreground-muted": "var(--muted-foreground)",
  "--chart-background": "var(--background)",
  "--chart-marker-background": "var(--background)",
  "--chart-marker-border": "var(--border)",
  "--chart-marker-foreground": "var(--foreground)",
  "--chart-ring-background": "transparent",
  // Tooltip text/surface — map to our popover tokens so it reads in both
  // themes. bklit's defaults are tuned for a dark tooltip (near-white text),
  // which is invisible on our light popover.
  "--chart-tooltip-background": "var(--popover)",
  "--chart-tooltip-foreground": "var(--popover-foreground)",
  "--chart-tooltip-muted": "var(--muted-foreground)",
} as React.CSSProperties;

// Style the tooltip box like the app's popovers/dropdowns so it sits on the
// cubby elevation system instead of an ad-hoc shadow. `--popover` is surface-3,
// and `--surface-shadow-3` is the same ring + layered-drop recipe popovers use
// (the 1px ring is the edge, so no manual border); `--surface-rim-3` adds the
// dark-mode inset highlight. Also turns off bklit's `backdrop-blur` glass,
// which the design system avoids.
const TOOLTIP_PANEL_STYLE: React.CSSProperties = {
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  boxShadow: "var(--surface-shadow-3), var(--surface-rim-3)",
  backdropFilter: "none",
};

// Daily bars are the secondary series, so they use the design system's neutral
// fill token, softened so the bars recede behind the Signal Blue "total" line
// (the primary series) instead of out-shouting it. Stays high-contrast in both
// themes since --neutral flips dark/light with the theme.
const BAR_FILL = "color-mix(in oklch, var(--neutral) 65%, transparent)";

const intFmt = new Intl.NumberFormat("en-US").format;

function toDate(day: string) {
  // Snapshot days are "YYYY-MM-DD" (UTC); pin to UTC noon so the local-time
  // label never slips to the previous day.
  return new Date(`${day}T12:00:00Z`);
}

/** Percentile bucket (1–100) for an all-time install rank. */
function topPercent(rank: number, total: number) {
  return Math.min(100, Math.max(1, Math.ceil((rank / total) * 100)));
}

export function SkillInsightsSection({
  insights,
  className,
}: {
  insights: SkillInsights;
  className?: string;
}) {
  const { snapshots, installRank, totalSkills, trendingRank, hotChange } =
    insights;
  const hasEnough = snapshots.length >= MIN_POINTS;

  // One row per day carrying both series: `total` (cumulative installs, the
  // line) and `daily` (installs gained that day, the bars). Day-over-day steps
  // can go negative on a correction; floor at 0 so a bar never reads as a loss.
  const series = useMemo(
    () =>
      snapshots.map((s, i) => ({
        date: s.day,
        total: s.installs,
        daily:
          i === 0 ? 0 : Math.max(0, s.installs - snapshots[i - 1].installs),
      })),
    [snapshots],
  );

  // Installs gained over the trailing ~7 days, measured from the earliest
  // snapshot still inside the window. Null until the window has two points.
  const weekGain = useMemo(() => {
    if (snapshots.length < 2) return null;
    const latest = snapshots[snapshots.length - 1];
    const cutoff = toDate(latest.day).getTime() - 7 * 86_400_000;
    const start =
      [...snapshots].reverse().find((s) => toDate(s.day).getTime() <= cutoff) ??
      snapshots[0];
    const gain = latest.installs - start.installs;
    return gain > 0 ? gain : null;
  }, [snapshots]);

  return (
    <LabeledSection label="Insights" className={className}>
      <dl className="flex flex-wrap gap-x-10 gap-y-4">
        {installRank != null && totalSkills != null && (
          <Stat
            label="Popularity rank"
            value={`#${intFmt(installRank)}`}
            hint={`of ${intFmt(totalSkills)} · top ${topPercent(installRank, totalSkills)}%`}
          />
        )}

        {weekGain != null && (
          <Stat
            label="Installs added"
            value={`+${intFmt(weekGain)}`}
            hint="past 7 days"
            positive
          />
        )}

        {trendingRank != null && (
          <Stat
            label="Trending rank"
            value={`#${trendingRank}`}
            hint={
              hotChange != null && hotChange > 0
                ? `+${intFmt(hotChange)}/hr`
                : undefined
            }
          />
        )}
      </dl>

      <div className="mt-6">
        {hasEnough ? (
          <>
            <Legend />
            <div style={CHART_VARS}>
              {/* No load animation: a data panel on a content page shouldn't
                  make the user watch it reveal, and the composed reveal flashes
                  full→empty→wipe on mount. Render it static and present. */}
              <ComposedChart
                data={series}
                xDataKey="date"
                aspectRatio="5 / 2"
                maxBarSize={26}
                animationDuration={0}
                margin={{ top: 16, right: 14, bottom: 30, left: 14 }}
              >
                <Grid horizontal />
                {/* Bars on the default axis (daily, ~0–20), the line on its own
                    right axis (cumulative, hundreds) so each scales to fit. */}
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
                <XAxis numTicks={6} />
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
          </>
        ) : (
          <CollectingState daysCollected={snapshots.length} />
        )}
      </div>
    </LabeledSection>
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

function Stat({
  label,
  value,
  hint,
  positive,
}: {
  label: string;
  value: string;
  hint?: string;
  positive?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex items-baseline gap-1.5">
        <span
          className={cn(
            "text-base font-medium tabular-nums",
            positive ? "text-success-foreground" : "text-foreground",
          )}
        >
          {value}
        </span>
        {hint && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {hint}
          </span>
        )}
      </dd>
    </div>
  );
}

function CollectingState({ daysCollected }: { daysCollected: number }) {
  return (
    <div
      className="relative flex w-full items-center justify-center rounded-xl border border-border bg-muted/40 px-6 text-center"
      style={{ aspectRatio: "5 / 2" }}
    >
      {/* Faint baseline so the empty frame still reads as a chart area. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-6 bottom-10 border-t border-dashed border-border"
      />
      <div className="relative max-w-sm">
        <p className="font-mono text-eyebrow font-medium uppercase tracking-eyebrow text-muted-foreground">
          Collecting install data
        </p>
        <p className="mt-2 text-sm text-pretty text-muted-foreground">
          The install trend is recorded once a day and starts the moment a skill
          is tracked. Check back in a few days to see it fill in.
        </p>
        {daysCollected > 0 && (
          <p className="mt-2 text-xs tabular-nums text-muted-foreground/80">
            {daysCollected} of {MIN_POINTS} days collected
          </p>
        )}
      </div>
    </div>
  );
}
