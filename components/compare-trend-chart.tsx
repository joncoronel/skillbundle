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
 * Date labels asked for, by how wide the chart was actually laid out.
 *
 * Six is the old chart's `XAxis numTicks={6}`, and it is what this card fits on
 * a desktop. A phone does not fit six, and the label thinning that catches the
 * overflow (`AXIS_TICK_LABELS.thin`) drops candidates greedily rather than
 * evenly: measured at 390px it left Jul 31, Aug 13, Aug 21 — thirteen days,
 * then eight, on an axis whose whole job is even time. Asking for fewer up
 * front means thinning never has to fire, and `evenlySpaced` still rounds the
 * count to whatever divides the series exactly.
 *
 * The install chart escapes this by luck rather than design: it asks for five
 * over the same range, `evenlySpaced` returns four because 21 divides by three,
 * and all four survive. Do not read its axis as evidence that thinning
 * preserves spacing.
 */
const COMPARE_TICK_COUNT = 6;
const COMPARE_TICK_COUNT_NARROW = 4;

/**
 * Below this scene width the axis takes the narrow count.
 *
 * Read off the chart, not the viewport: the card is what the labels have to
 * fit in, and `defineChart`'s builder is handed the scene width for exactly
 * this. A viewport media query would be measuring the wrong box.
 */
const NARROW_CHART_WIDTH = 480;

const LINE_ID = "installs";

/**
 * Days the placeholder series spans while the real data loads.
 *
 * The real range is whatever the snapshots turn out to cover, so this is a
 * guess — and the closer it lands, the better the arrival looks: the renderer
 * "morphs compatible numeric SVG geometry", and two paths are compatible when
 * they carry the same command count. Miss, and the lines snap into place
 * instead of travelling, which is a worse arrival rather than a broken one.
 * The case that has to be right is not this one but the placeholder-data case
 * (adding a skill with a chart already on screen), where both sides span the
 * same days by construction.
 */
const SKELETON_DAYS = 21;

/**
 * How long the placeholder is given to clear before the real series wipes in.
 *
 * bklit's loading→ready order, which is what this chart borrows: the
 * placeholder conceals to the right, the y scale retargets while nothing is
 * showing, then the real series is revealed. The alternative is to let the
 * renderer morph placeholder geometry into real geometry, which is smoother but
 * says the two are the same measurement changing — and one of them is invented.
 * Concealing says the placeholder is being replaced, which is what happened.
 *
 * Mirrors the `.chart-conceal` animation in `charts.css`; the two have to move
 * together or the phase outlasts the wipe and the plot sits empty waiting.
 */
const CONCEAL_MS = 180;

/**
 * Shortest time the placeholder stays up once it has been shown at all.
 *
 * Not a spinner floor. The objection to those is that they exist only to say
 * "wait", so holding data back to keep one on screen is pure cost — and this
 * codebase derives its loading states from cache rather than timing them for
 * that reason. What makes this different is the exit: the placeholder leaves
 * through a 180ms conceal and a 450ms reveal, and on a client navigation the
 * data lands ~1 frame after the chart mounts. Without a floor we conceal
 * something nobody saw, and the placeholder reads as a flash rather than a
 * state.
 *
 * Note there is no timer-free version of this choice. Skipping the ceremony on
 * a fast load needs the same "how long was it loading" that the floor needs, so
 * the decision is which of the two a timer buys, not whether to have one. A
 * floor on the FETCH would be the tidier shape, and is not available: Convex
 * queries resolve through a `queryFn` installed globally on the query client,
 * so flooring one would floor every query in the app — and this result also
 * feeds each column's rank, which has no reason to wait.
 *
 * `useHeldFlag` owns the timing; this is only the number.
 *
 * 400ms shows about a third of a band crossing (`chart-loading-sweep` is
 * 1200ms per crossing), which with the label is enough to register as a state.
 * The two are coupled: a shorter floor wants a faster sweep to stay legible.
 *
 * Only ever paid when the placeholder was rendered at all. A cached query
 * reports `isPending: false` on the first render, so `phase` starts at `ready`
 * and nothing here runs.
 */
const PLACEHOLDER_FLOOR_MS = 400;

/**
 * The plot's inset inside the chart box.
 *
 * Shared by the definition's `margin` and the loading label that centres on it,
 * because the two have to agree: the margins are asymmetric (a y-axis gutter on
 * the left, a date row underneath), so a label centred on the BOX sits 16px off
 * the plot on both axes. Scene units are CSS pixels here — the viewBox always
 * equals the container's width — so these carry straight into `style`.
 */
const CHART_MARGIN = {
  top: 16,
  right: 16,
  bottom: X_AXIS_LABEL_MARGIN_WITH_Y_AXIS,
} as const;

/** Placeholder lines are neutral: they are not any skill's colour. */
const SKELETON_LINE_COLOR = "var(--muted-foreground)";

/**
 * Stand-in series carrying the real series' keys.
 *
 * This is what lets one chart instance span loading and loaded. TanStack Charts
 * has no loading state and should not — it is a rendering grammar — so the
 * choice is between swapping the chart for a spinner and giving it something to
 * draw. Swapping is what this page used to do, and it costs the thing that
 * makes the loaded state good: with the chart mounted, new data is a keyed
 * update, so the y scale tweens across its change rather than cutting. Tear it
 * down and every arrival is a fresh mount instead.
 *
 * The LINES do not morph across an added skill — the shared date range grows,
 * so every path's command count changes and the renderer can only interpolate
 * compatible geometry. docs/charts.md has the measurement.
 *
 * The keys have to match the real ones (`s0`/`s1`/`s2`) or the update has no
 * identity to travel along. Everything else is deliberately not real: a neutral
 * stroke, and the y axis drops its labels while this is on screen (see the
 * definition) so no invented number is ever printed.
 */
function skeletonSeries(keys: string[]): CompareSeries[] {
  // `Date.now()` at call time, not per render: the memo above only re-runs when
  // the keys change, so the day window is stable for the life of a placeholder.
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
 * Accumulated from a daily GAIN rather than evaluated as a curve, which is what
 * gives it shoulders. The gain ebbs and flows (the sine) but never goes
 * negative (the `1 + 0.7 *` keeps its factor in 0.3–1.7), so the running
 * total is still monotonic — a cumulative install count cannot fall, and a
 * placeholder that dipped would be drawing a shape the real data can never
 * take. Varying the slope buys the visual interest without telling that lie.
 *
 * `index` shifts each line's phase and band, so three of them read as three
 * trajectories rather than one thick stroke travelling together.
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
  // doing about it, which outlasts it by the length of the conceal. Holding the
  // placeholder's definition through `concealing` is the whole point: swap it
  // for real rows on the frame the data lands and the renderer morphs one into
  // the other, which is the thing this ordering exists to avoid.
  // The floor lives in `useHeldFlag`, so what reaches the phase machine is
  // already "loading, for long enough to be worth concealing".
  const heldLoading = useHeldFlag(loading, PLACEHOLDER_FLOOR_MS);

  const [phase, setPhase] = useState<"loading" | "concealing" | "ready">(
    heldLoading ? "loading" : "ready",
  );
  // Adjusting state to a prop change during render, not in an effect: React
  // re-runs the component immediately without committing the stale phase, so
  // there is no frame where the data has landed and the chart still says it is
  // loading. An effect would paint that frame, and the lint rule against
  // synchronous `setState` in an effect body is pointing at the same thing.
  if (heldLoading && phase !== "loading") setPhase("loading");
  else if (!heldLoading && phase === "loading") setPhase("concealing");

  useEffect(() => {
    if (phase !== "concealing") return;
    // Nothing to sit through when the conceal is not being drawn.
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const timer = setTimeout(() => setPhase("ready"), reduced ? 0 : CONCEAL_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const showPlaceholder = phase !== "ready";

  // Keyed on the series KEYS, not on `series`: real data landing during the
  // floor gives that array a new identity, and rebuilding the definition then
  // re-lays the chart out and restarts the sweep mid-crossing.
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
            // Gone with the y labels while the placeholder is up, and for the
            // same reason: the skeleton spans the last three weeks ending
            // today, the real series ends wherever its snapshots do, and a date
            // range is as much a claim about the data as a count is. Leaving
            // them on had the axis announce Aug 7–27 and then jump back to
            // Jul 31–Aug 21 on the reveal.
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
            // The grid rules stay while loading — they are the frame, and it is
            // real — but their labels go. A placeholder line is a shape, which
            // reads as "something will be here"; a placeholder number reads as a
            // measurement, and there is no way to draw one honestly.
            tickLabels: showPlaceholder ? false : AXIS_TICK_LABELS,
          },
        },
        gradients: drawable.map((s) =>
          fadeEdgesGradient(fadeEdgesId(s.key), s.color),
        ),
        // `left` is solved, not pinned: it is the only side whose content the
        // chart does not know in advance, and letting the solver size it to the
        // labels it is actually drawing is what keeps the plot as wide as it
        // was before any of this. Only the placeholder pins it, and only to
        // stand in for the labels it is not drawing. See
        // `PLACEHOLDER_LEFT_MARGIN`.
        margin: CHART_MARGIN,
        theme: CHART_THEME,
      }),
      // The builder owns the spec; these are definition options, which take the
      // second argument once the first is a function.
      {
        // Nothing on a placeholder is worth reporting a value for, and there are
        // two ways to ask: `pointer: false` is already permanent (the overlay
        // owns the gesture), so the tooltip has to go at the source, and
        // `keyboard` separately — arrow keys still move focus on a chart whose
        // pointer handling is off, which is how a reader would otherwise land a
        // tooltip on an invented number.
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

  // "No history yet" is a resolved answer, so it must not swallow "not answered
  // yet" — while loading, `drawable` is the placeholder set and never empty.
  if (!showPlaceholder && drawable.length === 0) {
    return (
      <div>
        <CompareLegend series={series} />
        {/* Exactly the placeholder's box, message included, so resolving to
            "no history" changes nothing about the section's height. The text
            sits INSIDE it for that reason, and it reads better there anyway:
            the loading label occupies the same place in the same box. */}
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
      {/* Holds the chart's box while it waits one commit for a measurable
          container — see `useMeasuredHost`. The ratio matches the chart's own
          `aspectRatio`, so the box does not change size when the chart lands in
          it, and the section below never moves. */}
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
              // The sweep belongs to the placeholder, the conceal to it
              // leaving, the wipe to the real series arriving. `concealing`
              // deliberately carries TWO of them: the mask has to stay on or
              // the placeholder flashes to full strength on its way out, which
              // is why `charts.css` needs a combined `.chart-loading.chart-conceal`
              // rule to run both animations. A class change is a prop change,
              // so the host re-renders and each animation starts on a node that
              // has been sitting there, which is what moves the reveal off the
              // mount and onto the data.
              className={cn(
                // `chart-loading` spans BOTH placeholder phases, not just the
                // first. It carries the mask that makes the band the line, so
                // dropping it at `concealing` un-masks the placeholder — the
                // whole invented curve snaps to full strength for the 180ms it
                // takes to clip away, which is the flash of a complete grey
                // chart just before the real one arrives.
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
        {/* AFTER the chart, because DOM order is what puts it on top: both this
            and the overlay's root are positioned, so the later one paints over.
            Placed first, the plate below sat under the SVG and the lines went
            straight through the text.

            Names the wait, and leaves just before the placeholder does: 150ms
            against the conceal's 180, so it is gone by the time the plot clears
            rather than racing the unmount. Both move together — the label must
            stay the shorter of the two.

            Down, blurred and faded is bklit's exit for the same label, and it is
            already this app's gesture — `Crossfade` moves every swap on
            `opacity, filter, translate` over 240ms of the same curve. Borrowing
            that rather than bklit's 30px keeps one vocabulary.

            No spinner beside it. The house loader is `DotMatrixRipple` and this
            chart deliberately dropped it: the sweeping placeholder is the
            indicator, and a second one would be saying the same thing twice.
            Static text, too — a pulse would take `muted-foreground` under the
            4.5:1 it is tuned to sit at.

            `aria-hidden` because `aria-busy` above and the chart's own
            `ariaLabel` already carry this to a screen reader. */}
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
            {/* The plot's centre is where a grid rule and the placeholder
                curves all cross, so the text was struck through on both
                viewports. This is `bg-card` — the section's own surface — so it
                reads as the lines breaking around the label rather than as a
                chip sitting on top of them. No border and no shadow: it is
                occluding, not elevated. */}
            <span
              className={cn(
                "rounded-md px-2.5 py-1",
                // One tier above the section, which is `--card` (`surface-3`).
                // `solidSurface` rather than `elevatedSurface` because it paints
                // the rim into the same `box-shadow` instead of an `::after`,
                // and a label with nothing but text at its edges does not need
                // the overlay — or the `relative` and z-index that come with it.
                // In light both tiers are pure white, so the separation is the
                // shadow alone; in dark it is also a real lightness step.
                solidSurface(4),
              )}
            >
              {/* Two spans, and they cannot be one: `shimmer` paints through
                  `background-clip: text`, which clips EVERY background on its
                  element to the glyphs — so a plate sharing it would be clipped
                  to the letters and disappear.

                  The highlight is pinned to `foreground` rather than left to
                  derive. Unset, it resolves to `currentColor` at 20% alpha,
                  which in light mode fades `muted-foreground` well under the
                  4.5:1 it is tuned to sit at. Pinned, the band darkens in light
                  and brightens in dark — contrast rises either way, and the
                  text reads as lighting up rather than washing out.

                  1200ms is how long one band takes to cross the chart (its
                  2400ms cycle carries two), so a text sweep and a chart band
                  keep the same tempo rather than beating against each other.
                  Change one and the other has to follow. */}
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
