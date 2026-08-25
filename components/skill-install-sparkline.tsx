"use client";

import { useCallback, useMemo, useRef } from "react";
import { defineChart, lineY } from "@tanstack/charts";
import { scalePoint } from "@tanstack/charts/scales/point";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { RendererChart } from "@tanstack/charts/react/tooltip";
import { INITIAL_WIDTH, useChartHostProps } from "@/components/charts/chart";
import { CHART_THEME } from "@/components/charts/chart-theme";
import {
  ChartHoverOverlay,
  useChartHoverOverlay,
} from "@/components/charts/chart-hover-overlay";
import { CHART_CURVE, HOVER_DIM } from "@/components/charts/series-state";
import {
  seriesSummary,
  type SkillInsights,
  type SparklineHoverState,
} from "@/components/skill-chart-shared";

const LINE_ID = "installs";

// The line has no `z`, so its focused points carry the mark id as their key.
const HOVER_MARKERS = [
  {
    key: LINE_ID,
    color: "var(--primary)",
    label: "Installs",
  },
];

/**
 * Compact cumulative-installs sparkline for the sidebar, keeping its spring dot
 * and the hover dim/highlight, scaled so the slope is actually visible. The
 * chart's y-domain is zero-based, and a cumulative count in the hundreds of
 * thousands moves only a few percent over a week — plotting the absolute total
 * pins the line flat at the top. So we plot each point's installs ABOVE the
 * window minimum instead, which makes the domain span the real variation; the
 * hover callback still reads the untouched `installs` field, so the sidebar
 * scrubs the true total.
 *
 * This is the only chart above the fold on the skill page, so it ships eager.
 * The heavier dialog chart lives in its own file (skill-install-chart) so its
 * bar mark doesn't ride along in this bundle.
 */
export function InstallSparkline({
  points,
  onHover,
}: {
  points: SkillInsights["snapshots"];
  onHover?: (state: SparklineHoverState) => void;
}) {
  const definition = useMemo(() => {
    const min = points.length ? Math.min(...points.map((p) => p.installs)) : 0;
    // `plot` = installs above the window floor: it drives the zero-based domain
    // so the line isn't flat. `installs` stays intact for the hover callback.
    const rows = points.map((p) => ({
      date: p.day,
      installs: p.installs,
      plot: p.installs - min,
    }));

    return defineChart({
      marks: [
        lineY(rows, {
          id: LINE_ID,
          x: "date",
          y: "plot",
          curve: CHART_CURVE,
          stroke: "var(--primary)",
          strokeWidth: 1.5,
          states: [HOVER_DIM],
        }),
      ],
      x: { scale: scalePoint },
      y: { scale: scaleLinear },
      // No axes, no grid — and `guides: false` also drops the margins they
      // would otherwise reserve, which is what keeps the line full-width.
      guides: false,
      margin: { top: 4, right: 3, bottom: 4, left: 3 },
      theme: CHART_THEME,
      // Snap to the nearest column from anywhere in the strip. The finite
      // default would drop focus in the gaps above a low point.
      focus: "nearest-x",
      maxFocusDistance: Number.POSITIVE_INFINITY,
      // The overlay owns the gesture; see `chart-hover-overlay`.
      pointer: false,
      // The value is surfaced by the sidebar via `onHover`, so this chart wants
      // the dot and the dim without a panel over a 40px-tall strip.
      focusRing: false,
      keyboard: false,
    });
  }, [points]);

  // `onFocusChange` fires on every committed prop set, not only when focus
  // moves, and the adapter re-forwards props on each render. Reporting the same
  // day twice would set parent state, re-render, and be called again — so the
  // hovered day is compared before it is forwarded, and the reported object is
  // rebuilt only when it actually changed.
  const hostProps = useChartHostProps();
  const overlay = useChartHoverOverlay({
    labels: [],
    markers: HOVER_MARKERS,
  });
  const lastDay = useRef<string | null>(null);
  const handleFocusChange = useCallback(
    (
      point:
        ({ x: number } & { datum: { installs: number; date: string } }) | null,
    ) => {
      const day = point?.datum.date ?? null;
      if (day === lastDay.current) {
        return;
      }
      lastDay.current = day;
      onHover?.(
        point ? { value: point.datum.installs, day: point.datum.date } : null,
      );
    },
    [onHover],
  );

  return (
    // No rule or pill over a 40px strip; the sidebar prints the value.
    <ChartHoverOverlay controller={overlay} dotScale={0.75} showPill={false}>
      <RendererChart
        {...hostProps}
        initialWidth={INITIAL_WIDTH.sparkline}
        ariaLabel={`Install trend over the past week: ${seriesSummary(points)}.`}
        aspectRatio={7}
        definition={definition}
        onFocusChange={handleFocusChange}
        onRender={overlay.onRender}
      />
    </ChartHoverOverlay>
  );
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
      className="h-10 w-full mask-[linear-gradient(to_right,#000,#000_30%,transparent)] text-muted-foreground/45"
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
