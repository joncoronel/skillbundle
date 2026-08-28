"use client";

import { useEffect, useMemo, useState } from "react";
import { useHeldFlag } from "@/hooks/use-held-flag";
import { defineChart, lineY } from "@tanstack/charts";
import { scalePoint } from "@tanstack/charts/scales/point";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { RendererChart } from "@tanstack/charts/react/tooltip";
import { cn } from "@/lib/utils";
import { solidSurface } from "@/lib/cubby-ui/elevated";
import {
  CHART_REVEAL_CLASS,
  INITIAL_WIDTH,
  chartHostProps,
  useMeasuredHost,
} from "@/components/charts/chart";
import {
  AXIS_TICK_LABELS,
  evenlySpaced,
  CHART_THEME,
  datePillOffset,
  X_AXIS_LABEL_MARGIN_WITH_Y_AXIS,
  X_AXIS_LABEL_PADDING_WITH_Y_AXIS,
} from "@/components/charts/chart-theme";
import {
  ChartHoverOverlay,
  useChartHoverOverlay,
} from "@/components/charts/chart-hover-overlay";
import { focusCrosshair } from "@/components/charts/focus-crosshair";
import { CHART_TOOLTIP } from "@/components/charts/chart-tooltip";
import {
  ChartTooltipPanel,
  tooltipRows,
} from "@/components/charts/chart-tooltip-panel";
import { CHART_CURVE, HOVER_DIM } from "@/components/charts/series-state";
import { fadeEdgesGradient, fadeEdgesId } from "@/components/charts/fade-edges";
import {
  compactCount,
  dayLabel,
  dayLabelLong,
  intFmt,
  MIN_POINTS,
  seriesSummary,
  type SkillInsights,
} from "@/components/skill-chart-shared";

// One categorical color per compared skill, anchored on the brand accent. The
// compare page maps each column to its index here so the column header dot,
// legend swatch, and line all carry the same hue. Capped at the 3-column max.
export const COMPARE_LINE_COLORS = [
  "var(--compare-line-1)",
  "var(--compare-line-2)",
  "var(--compare-line-3)",
];

/**
 * Date labels asked for, by how wide the chart was laid out.
 *
 * Six is the old chart's `XAxis numTicks={6}` and what this card fits on a
 * desktop. A phone does not, and the thinning that catches the overflow
 * (`AXIS_TICK_LABELS.thin`) drops candidates greedily: measured at 390px it
 * left Jul 31, Aug 13, Aug 21 — thirteen days, then eight, on an axis whose
 * job is even time. Asking for fewer means thinning never fires.
 */
const COMPARE_TICK_COUNT = 6;
const COMPARE_TICK_COUNT_NARROW = 4;

/**
 * Below this SCENE width the axis takes the narrow count. Not the viewport: the
 * card is the box the labels have to fit, and the builder is handed its width.
 */
const NARROW_CHART_WIDTH = 480;

const LINE_ID = "installs";

/**
 * Days the placeholder spans. A guess at a range only the snapshots know, and
 * the closer it lands the better the arrival: the renderer morphs paths only
 * when their command counts match. Missing costs a snap, not correctness.
 */
const SKELETON_DAYS = 21;

/**
 * How long the placeholder is given to clear before the real series wipes in.
 *
 * Concealing rather than morphing one into the other: a morph says the two are
 * the same measurement changing, and one of them is invented.
 *
 * Mirrors `.chart-conceal` in `charts.css`. The two move together or the phase
 * outlasts the wipe and the plot sits empty waiting.
 */
const CONCEAL_MS = 180;

/**
 * Shortest time the placeholder stays up once shown at all. `useHeldFlag` owns
 * the timing and the argument for it; this is only the number.
 *
 * 400ms is about a third of a band crossing (1200ms), enough to register as a
 * state. Shorten it and the sweep has to speed up to stay legible.
 *
 * A floor on the FETCH would be tidier and is not available: Convex queries
 * resolve through a `queryFn` installed globally on the query client, so
 * flooring one floors every query in the app.
 *
 * Never paid on a cached query, which reports `isPending: false` on the first
 * render — `phase` starts at `ready` and nothing here runs.
 */
const PLACEHOLDER_FLOOR_MS = 400;

/**
 * The plot's inset inside the chart box, shared by the definition's `margin`
 * and the loading label that centres on it — the margins are asymmetric, so a
 * label centred on the BOX sits 16px off the plot. Scene units are CSS pixels
 * (the viewBox always equals the container's width), so these carry into
 * `style` unchanged.
 */
const CHART_MARGIN = {
  top: 16,
  right: 16,
  bottom: X_AXIS_LABEL_MARGIN_WITH_Y_AXIS,
} as const;

/** Placeholder lines are neutral: they are not any skill's colour. */
const SKELETON_LINE_COLOR = "var(--muted-foreground)";

/**
 * Stand-in series carrying the real series' keys, which is what lets ONE chart
 * instance span loading and loaded. The library has no loading state by design,
 * so the choice is a spinner swap or giving the chart something to draw — and
 * swapping costs what makes the loaded state good: with the chart mounted, new
 * data is a keyed update and the y scale tweens rather than cutting.
 *
 * The keys must match the real ones (`s0`/`s1`/`s2`) or the update has no
 * identity to travel along. Everything else is deliberately not real: a neutral
 * stroke, and no y labels while it is up, so no invented number is printed.
 */
function skeletonSeries(keys: string[]): CompareSeries[] {
  // Read once per call, and the caller memoizes on the series keys, so the day
  // window is stable for the life of a placeholder.
  const today = new Date();
  const days = Array.from({ length: SKELETON_DAYS }, (_, i) => {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() - (SKELETON_DAYS - 1 - i));
    return day.toISOString().slice(0, 10);
  });

  return keys.map((key, index) => ({
    key,
    name: "",
    color: SKELETON_LINE_COLOR,
    snapshots: skeletonPoints(days, index),
  }));
}

/**
 * One placeholder series' points: rising, but not smoothly.
 *
 * Accumulated from a daily GAIN rather than evaluated as a curve, which gives
 * it shoulders. The gain ebbs but never goes negative (`1 + 0.7 *` holds its
 * factor in 0.3–1.7), so the total stays monotonic — a cumulative install count
 * cannot fall, and a placeholder that dipped would draw a shape the real data
 * can never take. `index` shifts each line's phase so three read as three.
 */
function skeletonPoints(days: string[], index: number) {
  const phase = index * 2.1;
  const scale = 1 - index * 0.28;
  let total = 320 * scale;

  return days.map((day, i) => {
    const t = i / (SKELETON_DAYS - 1);
    const gain = (0.6 + 0.9 * t) * (1 + 0.7 * Math.sin(t * 13 + phase));
    total += gain * 14 * scale;
    return { day, installs: Math.round(total) };
  });
}

export type CompareSeries = {
  /** Stable series key for the merged rows (e.g. "s0") — avoids odd chars. */
  key: string;
  name: string;
  color: string;
  snapshots: SkillInsights["snapshots"];
};

type CompareRow = {
  day: string;
  series: string;
  name: string;
  color: string;
  installs: number;
};

/**
 * Flattens each skill's daily snapshots onto a shared date axis: the union of
 * all days, each series carried forward over a skipped day and back-filled
 * before its first point, so every line spans the axis with no gaps. Cumulative
 * installs are monotonic, so carry-forward is the correct fill for a missed
 * cron day; the leading back-fill only affects a skill that started recording
 * later than the others (a short flat lead-in).
 *
 * One row per series per day (long form) rather than one wide row per day: it
 * is what `lineY`'s `z` grouping consumes, and it drops the wide-row shape's
 * `Record<string, unknown>` indexing in favour of a typed row.
 */
function buildCompareRows(series: CompareSeries[]): CompareRow[] {
  const days = Array.from(
    new Set(series.flatMap((s) => s.snapshots.map((p) => p.day))),
  ).sort();

  return series.flatMap((s) => {
    const byDay = new Map(s.snapshots.map((p) => [p.day, p.installs] as const));
    let last: number | null = null;
    const forward = days.map((d) => {
      const v = byDay.get(d);
      if (v != null) last = v;
      return last;
    });
    const first = forward.find((v) => v != null) ?? 0;

    return days.map((day, i) => ({
      day,
      series: s.key,
      name: s.name,
      color: s.color,
      installs: forward[i] ?? first,
    }));
  });
}

function CompareLegend({
  series,
  loading = false,
}: {
  series: CompareSeries[];
  loading?: boolean;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-1.5">
      {series.map((s) => {
        // Muting means "this skill has no history", which is a resolved
        // answer. While loading every series is empty, so it would say that
        // about all of them and the loading state would read as the empty one.
        const thin = !loading && s.snapshots.length < MIN_POINTS;
        return (
          <span
            key={s.key}
            className={`flex min-w-0 items-center gap-1.5 text-xs ${
              thin ? "text-muted-foreground/60" : "text-muted-foreground"
            }`}
          >
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ background: s.color, opacity: thin ? 0.4 : 1 }}
            />
            <span className="truncate">{s.name}</span>
          </span>
        );
      })}
    </div>
  );
}

/**
 * The single combined install chart for the compare page: cumulative installs
 * over time, one line per compared skill on a shared axis, so trajectory and
 * relative size read together. Below the per-line history threshold for every
 * skill it falls back to a ghost placeholder, matching the sidebar's
 * still-collecting state. Series without enough history are listed in the
 * legend (muted) but draw no line until they have points.
 *
 * `loading` draws placeholder lines rather than handing the slot to a spinner,
 * so the chart is mounted before its data exists — see `skeletonSeries`. It
 * leaves through three phases: the placeholder sweeps while it waits, conceals
 * to the right when the data lands, and the real series wipes in behind it.
 */
export function CompareTrendChart({
  series,
  loading = false,
}: {
  series: CompareSeries[];
  loading?: boolean;
}) {
  // The chart waits one commit for a container it can be laid out from; the
  // box below reserves the space meanwhile. See `useMeasuredHost`.
  const [boxRef, measured] = useMeasuredHost();

  // `loading` says whether the data is here; `phase` says what the chart is
  // doing about it, and outlasts it by the length of the conceal. Holding the
  // placeholder's definition through `concealing` is what stops the renderer
  // morphing invented geometry into real geometry on the frame data lands.
  const heldLoading = useHeldFlag(loading, PLACEHOLDER_FLOOR_MS);

  const [phase, setPhase] = useState<"loading" | "concealing" | "ready">(
    heldLoading ? "loading" : "ready",
  );
  // Adjusted during render, not in an effect: React re-runs the component
  // without committing the stale phase, so no frame paints with the data landed
  // and the chart still saying it is loading. An effect would paint that frame.
  if (heldLoading && phase !== "loading") setPhase("loading");
  else if (!heldLoading && phase === "loading") setPhase("concealing");

  useEffect(() => {
    if (phase !== "concealing") return;
    // Nothing to sit through when the conceal is not drawn.
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const timer = setTimeout(() => setPhase("ready"), reduced ? 0 : CONCEAL_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const showPlaceholder = phase !== "ready";

  // Keyed on the series KEYS, not `series`: data landing during the floor gives
  // that array a new identity, and rebuilding the definition re-lays the chart
  // out and restarts the sweep mid-crossing.
  const seriesKeys = series.map((s) => s.key).join(",");
  const placeholder = useMemo(
    () => skeletonSeries(seriesKeys.split(",")),
    [seriesKeys],
  );

  const drawable = useMemo(() => {
    if (showPlaceholder) return placeholder;
    return series.filter((s) => s.snapshots.length >= MIN_POINTS);
  }, [series, showPlaceholder, placeholder]);

  // Above `definition`, which reads it for the axis tick candidates.
  const days = useMemo(
    () =>
      Array.from(
        new Set(drawable.flatMap((s) => s.snapshots.map((p) => p.day))),
      ).sort(),
    [drawable],
  );

  const definition = useMemo(() => {
    const rows = buildCompareRows(drawable);

    return defineChart(
      ({ width }) => ({
        marks: [
          lineY(rows, {
            id: LINE_ID,
            x: "day",
            y: "installs",
            // `z` splits the flat rows into one path per skill. Each path paints
            // with its own fade gradient, declared below from the colour the
            // compare page already assigned — so the line, the column header dot
            // and the legend swatch cannot drift apart.
            z: "series",
            stroke: (row: CompareRow) => `url(#${fadeEdgesId(row.series)})`,
            strokeWidth: 2,
            curve: CHART_CURVE,
            states: [HOVER_DIM],
          }),
          // Last, so it paints over the lines rather than under them.
          focusCrosshair(days.length),
        ],
        scales: {
          // Days are discrete samples, one per cron run, so they are positions on a
          // point scale rather than instants on a time scale. This also keeps every
          // tick landing on a real data point, which is what the old chart's
          // `tickMode="data"` was for.
          x: {
            scale: scalePoint,
            axis: {
              line: false,
              ticks: {
                size: 0,
                padding: X_AXIS_LABEL_PADDING_WITH_Y_AXIS,
                format: dayLabel,
                // The old chart's `numTicks={6}`. A point scale offers every day as
                // a candidate and ignores `count`, so without this the axis prints
                // one label per day that fits — nearly twice as many as before.
                values: evenlySpaced(
                  days,
                  width < NARROW_CHART_WIDTH
                    ? COMPARE_TICK_COUNT_NARROW
                    : COMPARE_TICK_COUNT,
                ),
              },
              // Gone with the y labels, and for the same reason: a date range
              // claims as much about the data as a count does. Left on, the axis
              // announced Aug 7–27 and jumped back to Jul 31–Aug 21 on the reveal.
              tickLabels: showPlaceholder ? false : AXIS_TICK_LABELS,
            },
          },
          y: {
            // Zero-based with a tenth of headroom, as the old chart's y-domain was.
            // Letting the scale infer from the data starts the axis near the
            // smallest series, which exaggerates the gaps between skills — the one
            // thing this chart exists to compare honestly.
            // A configured instance, not a factory: a factory infers its domain from
            // the marks and would discard the zero below.
            scale: scaleLinear().domain([
              0,
              rows.reduce((max, r) => Math.max(max, r.installs), 0) * 1.1,
            ]),
            nice: true,
            grid: true,
            axis: {
              line: false,
              // Abbreviated like the install stats directly below the chart, so the
              // axis and the tiles read in the same units.
              ticks: { count: 4, size: 0, format: compactCount },
              // The rules stay while loading (the frame is real), the labels go:
              // a placeholder line is a shape, a placeholder number is a claim.
              tickLabels: showPlaceholder ? false : AXIS_TICK_LABELS,
            },
          },
        },
        gradients: drawable.map((s) =>
          fadeEdgesGradient(fadeEdgesId(s.key), s.color),
        ),
        // No `left`: the solver sizes that side to the labels it is drawing,
        // which is what keeps the plot as wide as its card. Pinning it costs
        // 4.3px of width on every load to spare one 31.7px shift when the
        // placeholder's labels arrive. See docs/charts.md.
        margin: CHART_MARGIN,
        theme: CHART_THEME,
      }),
      // Definition options, which take the second argument once the first is a
      // function.
      {
        // A placeholder has no value worth reporting. `pointer: false` is
        // already permanent (the overlay owns the gesture), so the tooltip goes
        // at the source, and `keyboard` separately — arrow keys still move focus
        // on a chart whose pointer handling is off.
        tooltip: showPlaceholder ? false : CHART_TOOLTIP,
        keyboard: !showPlaceholder,
        focus: "group-x",
        maxFocusDistance: Number.POSITIVE_INFINITY,
        // The overlay owns the gesture and every cursor visual; see
        // `chart-hover-overlay`. Without `focusRing: false` the chart paints its
        // own marker underneath ours — two dots, only one of them moving.
        focusRing: false,
        pointer: false,
      },
    );
  }, [drawable, days, showPlaceholder]);

  const hostProps = chartHostProps();

  const overlay = useChartHoverOverlay({
    markers: useMemo(
      () =>
        drawable.map((s) => ({
          key: s.key,
          color: s.color,
          label: s.name,
        })),
      [drawable],
    ),
    labels: useMemo(() => days.map(dayLabel), [days]),
  });

  // "No history yet" is a resolved answer and must not swallow "not answered
  // yet": while loading, `drawable` is the placeholder set and never empty.
  if (!showPlaceholder && drawable.length === 0) {
    return (
      <div>
        <CompareLegend series={series} />
        {/* Exactly the placeholder's box, so resolving to "no history" changes
            nothing about the section's height. The text sits inside it for that
            reason, where the loading label sat. */}
        <div className="flex aspect-5/2 w-full flex-col items-center justify-center gap-3">
          <CompareTrendGhost />
          <p className="max-w-sm text-center text-xs text-muted-foreground">
            Not enough history yet. Installs are recorded daily, and the
            comparison fills in as the trend builds.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div aria-busy={showPlaceholder || undefined}>
      <CompareLegend series={series} loading={showPlaceholder} />
      {/* Holds the box while the chart waits one commit for a measurable
          container (see `useMeasuredHost`). The ratio matches the chart's own
          `aspectRatio`, so nothing moves when it lands. */}
      <div
        ref={boxRef}
        className={cn("relative", !measured && "aspect-5/2 w-full")}
      >
        {measured && (
          <ChartHoverOverlay
            controller={overlay}
            disabled={showPlaceholder}
            pillOffset={datePillOffset(
              X_AXIS_LABEL_MARGIN_WITH_Y_AXIS,
              X_AXIS_LABEL_PADDING_WITH_Y_AXIS,
            )}
          >
            <RendererChart
              {...hostProps}
              initialWidth={INITIAL_WIDTH.compare}
              ariaLabel={
                showPlaceholder
                  ? "Loading installs over time"
                  : `Installs over time. ${drawable
                      .map((s) => `${s.name} ${seriesSummary(s.snapshots)}`)
                      .join("; ")}.`
              }
              aspectRatio={5 / 2}
              // Sweep belongs to the placeholder, conceal to it leaving, wipe
              // to the real series arriving. A class change is a prop change, so
              // each animation starts on a node already sitting there — which is
              // what moves the reveal off the mount and onto the data.
              className={cn(
                // Spans BOTH placeholder phases, so `concealing` carries two
                // classes: this holds the mask that makes the band the line, and
                // dropping it un-masks the whole invented curve for the 180ms it
                // takes to clip away. `charts.css` has the combined rule that
                // runs both animations.
                phase !== "ready" && "chart-loading",
                phase === "concealing" && "chart-conceal",
                phase === "ready" && CHART_REVEAL_CLASS,
              )}
              definition={definition}
              onFocusChange={overlay.onFocusChange}
              renderTooltipBody={({ points }) => (
                <ChartTooltipPanel
                  rows={tooltipRows(overlay.markers, points, (point) =>
                    intFmt(point.datum.installs),
                  )}
                  title={dayLabelLong(points[0]?.datum.day ?? "")}
                />
              )}
              onRender={overlay.onRender}
            />
          </ChartHoverOverlay>
        )}
        {/* AFTER the chart: both this and the overlay's root are positioned, so
            DOM order is what puts it on top. Placed first, the lines drew
            straight through the text.

            Leaves at 150ms against the conceal's 180, so it is gone by the time
            the plot clears rather than racing the unmount. It must stay the
            shorter of the two. Down-blur-fade is this app's own exit gesture
            (`Crossfade` moves every swap the same way).

            No spinner beside it: the sweeping placeholder IS the indicator, and
            DESIGN.md's `DotMatrixRipple` would say it twice. Static text too — a
            pulse takes `muted-foreground` under the 4.5:1 it is tuned for.

            `aria-hidden` because `aria-busy` and the chart's `ariaLabel` already
            carry this to a screen reader. */}
        {showPlaceholder && (
          <div
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute flex items-center justify-center",
              "transition-[opacity,filter,translate] duration-150",
              "ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
              "starting:opacity-0 starting:blur-sm",
              phase === "concealing" && "translate-y-3 opacity-0 blur-sm",
            )}
            style={{
              top: CHART_MARGIN.top,
              right: CHART_MARGIN.right,
              bottom: CHART_MARGIN.bottom,
              // No left margin to read: the placeholder draws no y labels, so
              // the solver gives it a ~4px gutter and its plot starts at the
              // card edge. Centring on 0 lands within 2px of the plot's centre.
              left: 0,
            }}
          >
            {/* A grid rule and the placeholder curves all cross at the plot's
                centre, so the text was struck through. The plate is the
                section's own surface, so it reads as the lines breaking around
                the label rather than a chip on top of them. */}
            <span
              className={cn(
                "rounded-md px-2.5 py-1",
                // One tier above the section (`--card` is `surface-3`).
                // `solidSurface`, not `elevatedSurface`: it paints the rim into
                // the same `box-shadow` instead of an `::after`, and text alone
                // does not need that overlay or its `relative` and z-index.
                solidSurface(4),
              )}
            >
              {/* Two spans, and they cannot be one: `shimmer` paints through
                  `background-clip: text`, which clips EVERY background on its
                  element to the glyphs, so a plate sharing it would vanish.

                  The highlight is pinned to `foreground`. Unset it resolves to
                  `currentColor` at 20% alpha, which fades `muted-foreground`
                  under the 4.5:1 it is tuned for; pinned, contrast rises in both
                  themes and the text reads as lighting up.

                  1200ms is one band crossing the chart (its 2400ms cycle carries
                  two), so text and chart keep one tempo. Change one, change
                  both. */}
              <span className="shimmer text-sm text-muted-foreground shimmer-color-foreground shimmer-duration-1200">
                Loading install history
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Faint two-line ghost for the compare chart's pre-history state. */
function CompareTrendGhost() {
  return (
    <svg
      viewBox="0 0 300 120"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="h-40 w-full mask-[linear-gradient(to_right,#000,#000_35%,transparent)]"
    >
      <path
        d="M0 92 C 40 88 70 70 110 64 C 150 58 190 40 240 30 C 270 24 288 22 300 20"
        fill="none"
        stroke="var(--compare-line-1)"
        strokeOpacity="0.35"
        strokeWidth="2"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d="M0 104 C 40 102 80 96 120 86 C 160 76 200 72 240 62 C 270 56 288 54 300 52"
        fill="none"
        stroke="var(--compare-line-2)"
        strokeOpacity="0.3"
        strokeWidth="2"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
