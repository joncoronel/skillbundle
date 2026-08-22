"use client";

import { useCallback, useEffect, useId, useMemo, useRef } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import {
  FOCUS_SPRING,
  HIGHLIGHT_SPRING,
  useCoarsePointer,
} from "./chart-motion";
import { TOOLTIP_OFFSET } from "./chart-tooltip";
import { cn } from "@/lib/utils";

// Everything that follows the cursor — the rule, the dots, the highlight band
// and the date pill — drawn over the chart and driven by Motion.
//
// The chart's own motion renderer springs its focus guides, but that path
// wedges under a fast pointer: retargeting it every frame leaves the rule and
// markers frozen wherever they were when the scrubbing started, and they do not
// recover when the pointer stops. The tooltip keeps updating throughout, so
// focus resolution is fine — it is the guide animation that gets stuck. Motion
// springs retarget from their current value and velocity, which is the
// behaviour the old chart had.
//
// Nothing here re-renders while the pointer moves. Focus updates land on
// MotionValues, which Motion writes straight to the DOM — important, because a
// React commit re-pushes props to the chart host and cancels its motion
// mid-flight (see AGENTS.md).

const TICKER_ITEM_HEIGHT = 24;

/**
 * Above this many days the crosshair and the date pill stop animating: the rule
 * and the highlight band jump to the focused column, the pill jumps with them,
 * and the ticker swaps its label instead of scrolling.
 *
 * The old chart's `discreteInteraction`, at the same count and over the same
 * three things — `TooltipIndicator animate={!discreteInteraction}`, the pill's
 * `left: discreteInteraction ? x : animatedX`, and the ticker's compact form.
 * The markers and the tooltip panel were NOT gated (`TooltipDot` took the
 * default `animate`, and this chart's tooltip box fell through to
 * `resolveTooltipBoxMotion`), so they keep springing at any length. Verified
 * against the live old chart at 64 points: the marker travels 17 distinct
 * positions between two columns.
 */
const DISCRETE_THRESHOLD = 60;

/**
 * Marker springs are allocated up front because hooks cannot be created in a
 * loop over a list that changes length — the compare page's series count moves
 * as columns are added and removed. Three is that page's column cap, and the
 * most any of our charts needs.
 */
const MAX_MARKERS = 3;

/**
 * The old chart's label ramp: hidden within `TICK_FADE_CLEARANCE` of the pill's
 * edge, then back to full over the next `TICK_FADE_BUFFER` pixels.
 *
 * It measured that first distance from the crosshair as a flat 50px — never the
 * pill's own width, which is about 40 either side. The difference is the point:
 * a label whose centre clears the pill by a few pixels still has half a glyph
 * behind it, and fading on centre distance alone leaves that sliver showing.
 */
const TICK_FADE_CLEARANCE = 10;
const TICK_FADE_BUFFER = 20;

/** The old `TooltipBox`'s inner entrance spring. */
const PANEL_ENTER_SPRING = {
  type: "spring",
  stiffness: 300,
  damping: 25,
} as const;

/** Where the panel starts its entrance, and how far it slides in. */
const PANEL_ENTER_SCALE = 0.85;
const PANEL_ENTER_SLIDE = 20;
/** The old wrapper's fade, in seconds. */
const PANEL_FADE = 0.1;

const DOT_RADIUS = 5;
const DOT_STROKE_WIDTH = 2.5;

export interface HoverMarker {
  /** Matches a focused point's group, or its mark id when it has no group. */
  key: string;
  color: string;
  /** Row label in the tooltip. */
  label: string;
  /**
   * The row's swatch, when the mark's own colour does not survive the panel.
   * The panel is the chrome surface — near-black in both themes — so a series
   * painted in a page tone (the daily bars' neutral) disappears on it.
   */
  swatch?: string;
}

interface MarkerValues {
  cx: MotionValue<number>;
  cy: MotionValue<number>;
  opacity: MotionValue<number>;
}

interface ChartBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FocusedPoint {
  x: number;
  y: number;
  group?: unknown;
  markId: string;
  datum: unknown;
  /** The point's semantic x — the key a focus group shares. */
  xValue?: unknown;
}

/** Comparable form of a point's x, so Dates match by value rather than identity. */
function xKey(value: unknown): string {
  return value instanceof Date ? String(value.getTime()) : String(value);
}

export interface ChartHoverOverlayController {
  readonly bandX: MotionValue<number>;
  readonly bandWidth: MotionValue<number>;
  readonly ruleX: MotionValue<number>;
  readonly plotTop: MotionValue<number>;
  readonly plotBottom: MotionValue<number>;
  readonly sceneWidth: MotionValue<number>;
  /** The chart's CSS width, and CSS pixels per scene unit. */
  readonly hostWidth: MotionValue<number>;
  readonly pxPerUnit: MotionValue<number>;
  /** In CSS pixels — the pill and the panel are HTML. */
  readonly pillX: MotionValue<number>;
  /** Half the pill's rendered width, measured by `DatePill`. */
  readonly pillHalf: MotionValue<number>;
  /** Scopes the generated per-label rules to this chart. */
  readonly tickScope: string;
  readonly tickStyleRef: React.RefObject<HTMLStyleElement | null>;
  readonly dayY: MotionValue<number>;
  readonly monthY: MotionValue<number>;
  readonly opacity: MotionValue<number>;
  readonly hostRef: React.RefObject<HTMLDivElement | null>;
  readonly labels: readonly string[];
  readonly markers: readonly HoverMarker[];
  readonly markerValues: readonly MarkerValues[];
  readonly monthSegments: readonly { month: string; key: string }[];
  readonly tooltipX: MotionValue<number>;
  readonly tooltipWidth: MotionValue<number>;
  readonly panelOpacity: MotionValue<number>;
  readonly panelScale: MotionValue<number>;
  readonly panelSlide: MotionValue<number>;
  /**
   * The panel's own nodes and its current content adapter.
   *
   * `showFocus` writes them inline rather than signalling through a
   * MotionValue: `useMotionValueEvent` keeps whichever callback was registered
   * on mount, and a listener reading refs through that stale closure ran a
   * focus change behind, so the panel showed the previous day's date.
   */
  readonly tooltipSlots: React.RefObject<TooltipSlots>;
  /** Pass to the chart's `onRender`; captures the plot box for the rule. */
  onRender: (info: {
    scene: {
      width: number;
      chart: ChartBox;
      points: readonly FocusedPoint[];
    };
    interaction: InteractionController;
  }) => void;
  /**
   * Pass to the chart's `onFocusChange`, which is how keyboard focus reaches
   * the overlay. Pointer focus is ours already; this is the other input.
   */
  onFocusChange: (point: FocusedPoint | null) => void;
  /** Spread onto the element wrapping the chart; owns the pointer gesture. */
  readonly pointerProps: {
    onPointerDown: (event: React.PointerEvent) => void;
    onPointerMove: (event: React.PointerEvent) => void;
    onPointerUp: (event: React.PointerEvent) => void;
    onPointerCancel: (event: React.PointerEvent) => void;
    onPointerLeave: (event: React.PointerEvent) => void;
  };
}

/**
 * The slice of the chart's interaction controller this overlay uses.
 *
 * Structural rather than imported: the real type is generic over the datum and
 * both axis values, and threading those through here would make the whole
 * overlay generic for no gain — it only ever reads pixel positions and group
 * membership. `never` on the focus target keeps the call sites honest, since
 * anything we pass came out of `resolvePointer` in the first place.
 */
interface InteractionController {
  resolvePointer: (
    clientX: number,
    clientY: number,
  ) => {
    /** Where the pointer landed, in scene units. */
    position: { x: number; y: number };
    points: readonly FocusedPoint[];
  } | null;
  setControlledFocus: (target: never) => void;
}

/**
 * How far outside the plot still counts as hovering it, in scene units.
 *
 * `resolvePointer` answers from anywhere in the element, including the axis
 * gutters, so without a bounds check the cursor appears while the pointer is
 * down among the tick labels. The old chart sized its capture rect to the plot
 * exactly; a few units of slack keep the topmost pixel of a bar and the
 * sparkline's 4px margins reachable.
 */
const PLOT_HIT_SLACK = 8;

/** Endpoint x of every command in a scene path — one per drawn sample. */
function samplePositions(path: string): number[] {
  const commands = path.match(/[A-Za-z][^A-Za-z]*/g);
  if (!commands) {
    return [];
  }
  const xs: number[] = [];
  for (const command of commands) {
    const numbers = command.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
    if (numbers && numbers.length >= 2) {
      xs.push(Number(numbers[numbers.length - 2]));
    }
  }
  return xs;
}

function nearestIndex(xs: readonly number[], x: number): number {
  let index = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < xs.length; i++) {
    const distance = Math.abs(xs[i] - x);
    if (distance < best) {
      best = distance;
      index = i;
    }
  }
  return index;
}

/**
 * Splits "Jun 17" into its month and day halves and collapses runs of the same
 * month, so the month track only moves when the month actually changes.
 */
function splitLabels(labels: readonly string[]) {
  const days = labels.map((label) => label.slice(label.indexOf(" ") + 1));
  const months = labels.map((label) => label.slice(0, label.indexOf(" ")));

  const segments: { month: string; key: string }[] = [];
  const segmentOfIndex: number[] = [];
  for (const [i, month] of months.entries()) {
    if (segments.at(-1)?.month !== month) {
      segments.push({ month, key: `${month}-${i}` });
    }
    segmentOfIndex.push(segments.length - 1);
  }
  return { days, segments, segmentOfIndex };
}

function useMarkerValues(transition: object): MarkerValues {
  return {
    cx: useSpring(0, transition),
    cy: useSpring(0, transition),
    opacity: useMotionValue(0),
  };
}

export function useChartHoverOverlay({
  labels,
  markers,
}: {
  /** One display label per day, e.g. "Jun 17", in axis order. */
  labels: readonly string[];
  /** One entry per series that should carry a dot, in any order. */
  markers: readonly HoverMarker[];
}): ChartHoverOverlayController {
  const hostRef = useRef<HTMLDivElement | null>(null);

  // Reduced motion has to be handled here because these values are ours — the
  // chart's own renderer honours the flag, Motion does not. It stills
  // everything; the density gate above stills only the crosshair and the pill.
  //
  // The springs are always built with real transitions and instantaneity is
  // decided per write, with `jump`. A spring configured `{ duration: 0 }` is
  // NOT instant — measured under `prefers-reduced-motion: reduce`, the focus
  // dot still travelled four intermediate positions — so the config that reads
  // like "settle immediately" quietly animates.
  const reducedMotion = useReducedMotion();
  const coarse = useCoarsePointer();
  const stillCursor =
    Boolean(reducedMotion) || labels.length > DISCRETE_THRESHOLD;
  const focus = FOCUS_SPRING;
  const highlight = HIGHLIGHT_SPRING;

  const bandX = useSpring(0, highlight);
  const bandWidth = useSpring(0, highlight);
  const ruleX = useSpring(0, focus);
  const pillX = useSpring(0, focus);
  const dayY = useSpring(0, focus);
  const monthY = useSpring(0, focus);
  const opacity = useMotionValue(0);
  const plotTop = useMotionValue(0);
  const plotBottom = useMotionValue(0);
  const sceneWidth = useMotionValue(0);
  const hostWidth = useMotionValue(0);
  const pillHalf = useMotionValue(0);
  // CSS pixels per scene unit.
  //
  // The chart lays its scene out in its own coordinate space and lets the
  // viewBox scale it to whatever the container really is, so the two are not
  // interchangeable: in the dialog a scene x of 564 paints at 594px. Anything
  // in the overlay's SVG inherits the same viewBox and needs no conversion —
  // but the pill and the panel are HTML, positioned in CSS px, and were reading
  // scene units straight into `left`. That left them further and further behind
  // the cursor toward the right edge, which is where the pill looked like it
  // gave up before the last point.
  //
  // Read off the painted SVG rather than derived from `scene.width`, which is
  // the container measurement and not the unit the scene is drawn in.
  const pxPerUnit = useMotionValue(1);
  const tooltipX = useSpring(0, focus);
  const tooltipWidth = useMotionValue(0);
  // The panel's own entrance, which the rest of the cursor does not have: the
  // old `TooltipBox` faded its wrapper in over 100ms while the panel inside
  // scaled up from 0.85 and slid 20px in from whichever side it had flipped to.
  const panelOpacity = useMotionValue(0);
  const panelScale = useSpring(1, PANEL_ENTER_SPRING);
  const panelSlide = useSpring(0, PANEL_ENTER_SPRING);
  const tooltipSlots = useRef<TooltipSlots>({
    title: null,
    rows: new Map(),
    values: new Map(),
    content: null,
    markers: [],
  });

  const marker0 = useMarkerValues(focus);
  const marker1 = useMarkerValues(focus);
  const marker2 = useMarkerValues(focus);
  const markerValues = useMemo(
    () => [marker0, marker1, marker2],
    [marker0, marker1, marker2],
  );

  const { segments, segmentOfIndex } = useMemo(
    () => splitLabels(labels),
    [labels],
  );

  const wasActive = useRef(false);
  // Parsing the line's path is the only per-pointer-move work here, so its
  // result is kept until the path itself changes.
  const samples = useRef<{ d: string; xs: number[] } | null>(null);

  const interaction = useRef<InteractionController | null>(null);
  const plotBox = useRef<ChartBox | null>(null);
  const scenePoints = useRef<readonly FocusedPoint[]>([]);
  // `useId` returns a value containing colons, which a class name cannot carry.
  const tickScope = `chart-ticks-${useId().replaceAll(":", "")}`;
  const tickStyleRef = useRef<HTMLStyleElement | null>(null);
  const tickCentres = useRef<number[]>([]);
  const measureFrame = useRef(0);
  const tickFades = useRef<number[]>([]);

  // One layout read per resize and per chart render — never per pointer move.
  const measureScale = useCallback(() => {
    const host = hostRef.current;
    const svg = host?.querySelector<SVGSVGElement>("svg.ts-chart");
    if (!host || !svg) {
      return;
    }
    const width = host.clientWidth;
    const units = svg.viewBox.baseVal.width;
    hostWidth.set(width);
    pxPerUnit.set(units > 0 ? width / units : 1);

    // Which date label sits where, and the rule that lets the overlay dim it.
    // Both are settled here because the tick set only changes when the chart
    // re-renders; a pointer move then costs a handful of custom properties on
    // one element and no selector work at all.
    //
    // The centre comes from the label's own `x` (they are `text-anchor:
    // middle`), converted like everything else, rather than from a measured
    // box. A box is in screen space and so carries any transform an ancestor
    // is mid-animation on — measured while the dialog was still scaling open,
    // every centre came out ~20px adrift and the wrong label faded.
    const scale = pxPerUnit.get();
    const labels = [
      ...svg.querySelectorAll<SVGTextElement>(
        'text[data-ts-key^="x-tick-label"]',
      ),
    ];
    tickCentres.current = labels.map(
      (label) => Number(label.getAttribute("x") ?? 0) * scale,
    );
    if (tickStyleRef.current) {
      tickStyleRef.current.textContent = labels
        .map((label, i) => {
          const key = (label.getAttribute("data-ts-key") ?? "").replaceAll(
            '"',
            '\\"',
          );
          return `.${tickScope} [data-ts-key="${key}"]{opacity:var(--tick-${i},1)}`;
        })
        .join("");
    }
  }, [hostWidth, pxPerUnit, tickScope]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) {
      return;
    }
    measureScale();
    const observer = new ResizeObserver(measureScale);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measureScale]);

  const onRender = useCallback(
    (info: {
      scene: {
        width: number;
        chart: ChartBox;
        points: readonly FocusedPoint[];
      };
      interaction: InteractionController;
    }) => {
      interaction.current = info.interaction;
      plotBox.current = info.scene.chart;
      scenePoints.current = info.scene.points;
      plotTop.set(info.scene.chart.y);
      plotBottom.set(info.scene.chart.y + info.scene.chart.height);
      sceneWidth.set(info.scene.width);
      samples.current = null;
      // After paint, not now: `onRender` runs with the scene in hand but before
      // the markup it describes is in the DOM, so measuring here reads the
      // PREVIOUS render's axis. On a chart whose data arrives late that is the
      // difference between labels that fade and labels that never do.
      cancelAnimationFrame(measureFrame.current);
      measureFrame.current = requestAnimationFrame(measureScale);
    },
    [plotTop, plotBottom, sceneWidth, measureScale],
  );

  useEffect(() => () => cancelAnimationFrame(measureFrame.current), []);

  // Per-label opacity for the pill's current position, written as custom
  // properties on the wrapper. Only the values that actually changed are
  // written, so a scrub between two labels touches one or two properties.
  const paintTickFade = useCallback(
    (pillCentre: number | null) => {
      const host = hostRef.current;
      if (!host) {
        return;
      }
      const hidden = pillHalf.get() + TICK_FADE_CLEARANCE;
      const centres = tickCentres.current;
      const previous = tickFades.current;
      for (let i = 0; i < centres.length; i++) {
        const distance =
          pillCentre === null
            ? Number.POSITIVE_INFINITY
            : Math.abs(centres[i] - pillCentre);
        const fade =
          distance < hidden
            ? 0
            : distance < hidden + TICK_FADE_BUFFER
              ? (distance - hidden) / TICK_FADE_BUFFER
              : 1;
        if (previous[i] !== fade) {
          previous[i] = fade;
          host.style.setProperty(`--tick-${i}`, fade.toFixed(2));
        }
      }
      previous.length = centres.length;
    },
    [pillHalf],
  );

  const showFocus = useCallback(
    (points: readonly FocusedPoint[]) => {
      const host = hostRef.current;
      if (points.length === 0 || !host) {
        opacity.set(0);
        // The panel fades rather than cutting, as the old wrapper's `exit` did.
        if (reducedMotion) {
          panelOpacity.jump(0);
        } else {
          animate(panelOpacity, 0, { duration: PANEL_FADE });
        }
        wasActive.current = false;
        paintTickFade(null);
        return;
      }

      // The line's own painted path is the source of truth for where the
      // samples are, so the band cannot drift off the trace it is highlighting.
      const linePath = host
        .querySelector("svg.ts-chart .ts-chart__line path")
        ?.getAttribute("d");
      if (!linePath) {
        opacity.set(0);
        return;
      }
      if (samples.current?.d !== linePath) {
        samples.current = { d: linePath, xs: samplePositions(linePath) };
      }
      const xs = samples.current.xs;
      if (xs.length === 0) {
        opacity.set(0);
        return;
      }

      const x = points[0].x;
      const index = nearestIndex(xs, x);
      const bandStart = xs[Math.max(0, index - 1)];
      const bandEnd = xs[Math.min(xs.length - 1, index + 1)];

      // Jump on the first frame of a hover so everything appears around the
      // cursor instead of sweeping in from the left edge; ease after that.
      const entering = !wasActive.current;
      // The crosshair rule, and only the rule: still at high density, which is
      // the whole of what the old chart's `TooltipIndicator animate` covered.
      const writeRule = (value: MotionValue<number>, next: number) => {
        if (entering || stillCursor) {
          value.jump(next);
        } else {
          value.set(next);
        }
      };
      // The band, the markers and the panel, which travel at any density — only
      // reduced motion stops them. The band lived in the old chart's line
      // layer, not its tooltip, and took no `animate` flag at all.
      const writeTravelling = (value: MotionValue<number>, next: number) => {
        if (entering || reducedMotion) {
          value.jump(next);
        } else {
          value.set(next);
        }
      };
      // The pill sits directly under the finger, so easing it reads as the
      // label lagging behind the touch rather than as motion. Everything else
      // still springs on touch — those are further from the contact point.
      const writePill = (value: MotionValue<number>, next: number) => {
        if (entering || stillCursor || coarse) {
          value.jump(next);
        } else {
          value.set(next);
        }
      };

      // The pill and the panel are HTML: they take CSS pixels, not scene units.
      const scale = pxPerUnit.get();
      const cssX = x * scale;
      const cssWidth = hostWidth.get();

      // The old placement rule, verbatim: sit one offset to the right of the
      // cursor, and flip to the left only when that would run past the chart.
      // Never anything in between — that is what keeps it off the marker. The
      // built-in tooltip clamps into the chart box instead, which slides it
      // back across the very point it is describing.
      const panel = tooltipWidth.get();
      const flip = cssX + TOOLTIP_OFFSET + panel > cssWidth;
      writeTravelling(
        tooltipX,
        flip ? cssX - TOOLTIP_OFFSET - panel : cssX + TOOLTIP_OFFSET,
      );
      paintTooltip(tooltipSlots.current, index, points);

      if (entering) {
        // Start small and offset toward the cursor, then spring into place. The
        // slide runs from whichever side the panel resolved to, so it always
        // grows out of the point it is describing.
        if (reducedMotion) {
          panelOpacity.jump(1);
        } else {
          panelScale.jump(PANEL_ENTER_SCALE);
          panelSlide.jump(flip ? PANEL_ENTER_SLIDE : -PANEL_ENTER_SLIDE);
          panelOpacity.jump(0);
          animate(panelOpacity, 1, { duration: PANEL_FADE });
        }
        panelScale.set(1);
        panelSlide.set(0);
      }

      writeTravelling(bandX, Math.min(bandStart, bandEnd));
      writeTravelling(bandWidth, Math.abs(bandEnd - bandStart));
      writeRule(ruleX, x);
      writePill(pillX, cssX);
      paintTickFade(cssX);
      writePill(dayY, -index * TICKER_ITEM_HEIGHT);
      writePill(monthY, -(segmentOfIndex[index] ?? 0) * TICKER_ITEM_HEIGHT);

      for (const [i, config] of markers.slice(0, MAX_MARKERS).entries()) {
        const values = markerValues[i];
        const point = points.find(
          (candidate) =>
            String(candidate.group ?? candidate.markId) === config.key,
        );
        if (!point) {
          values.opacity.set(0);
          continue;
        }
        writeTravelling(values.cx, point.x);
        writeTravelling(values.cy, point.y);
        values.opacity.set(1);
      }

      opacity.set(1);
      wasActive.current = true;
    },
    [
      bandX,
      bandWidth,
      ruleX,
      pillX,
      dayY,
      monthY,
      opacity,
      segmentOfIndex,
      markers,
      markerValues,
      tooltipX,
      tooltipWidth,
      hostWidth,
      pxPerUnit,
      pillHalf,
      paintTickFade,
      stillCursor,
      reducedMotion,
      coarse,
      panelOpacity,
      panelScale,
      panelSlide,
    ],
  );

  // The chart's own pointer handling is hover-shaped: it shows focus on move
  // and clears it on leave. Touch has no leave — a tap paints focus that then
  // sits there, and a drag is claimed by the browser as a scroll. So the
  // gesture is ours (`pointer: false` on the definitions) and mapped to what
  // each input actually means: a mouse inspects on hover, a finger inspects
  // only while it is down.
  const touchId = useRef<number | null>(null);

  // Identity of the column focus is on, so a pointer move that resolves to the
  // same one costs nothing.
  const lastFocus = useRef<unknown>(undefined);

  const inspect = useCallback(
    (event: React.PointerEvent) => {
      const resolved = interaction.current?.resolvePointer(
        event.clientX,
        event.clientY,
      );
      const box = plotBox.current;
      // A finger that has already grabbed the chart keeps it: the gesture is
      // captured, so it goes on scrubbing wherever it travels — off the plot,
      // off the dialog, anywhere — until it lifts, which is what the old chart
      // did. The bounds check is for a hovering mouse, which has no such
      // commitment and should let go the moment it is over the axis gutter
      // rather than the plot. Focus stays on the nearest column either way,
      // since every chart resolves with an unbounded `maxFocusDistance`.
      const dragging = touchId.current !== null;
      const inside =
        resolved && box
          ? dragging ||
            (resolved.position.x >= box.x - PLOT_HIT_SLACK &&
              resolved.position.x <= box.x + box.width + PLOT_HIT_SLACK &&
              resolved.position.y >= box.y - PLOT_HIT_SLACK &&
              resolved.position.y <= box.y + box.height + PLOT_HIT_SLACK)
          : false;
      const target = inside ? resolved : null;
      // Everything the overlay draws is anchored to the focused point, not to
      // the raw pointer, so between two positions over the same column there is
      // nothing to redraw. Skipping matters: `setControlledFocus` repaints the
      // whole scene and restarts the marks' state transitions, so calling it on
      // every move retargets the bars' 120ms fade every frame — the fade never
      // gets to run, which reads as it not having one.
      const key = target?.points[0]?.datum;
      if (key === lastFocus.current) {
        return;
      }
      lastFocus.current = key;
      interaction.current?.setControlledFocus((target ?? null) as never);
      showFocus(target?.points ?? []);
    },
    [showFocus],
  );

  // Keyboard focus. The chart keeps navigating by arrow keys under
  // `pointer: false` — that path is independent of the gesture we own — but it
  // only reports the PRIMARY point, so the group it belongs to is rebuilt here
  // from the scene. Without this, tabbing to a bar dims its neighbours (a mark
  // state, which the chart applies itself) while the cursor, pill and tooltip
  // stay hidden, which reads as focus doing half a job.
  const onFocusChange = useCallback(
    (point: FocusedPoint | null) => {
      if (!point) {
        if (lastFocus.current === undefined) {
          return;
        }
        lastFocus.current = undefined;
        showFocus([]);
        return;
      }
      // Our own pointer path has already drawn this one. `onFocusChange` also
      // fires on every committed prop set, not only when focus moves, so this
      // guard is what keeps a hover from repainting the overlay twice.
      if (point.datum === lastFocus.current) {
        return;
      }
      lastFocus.current = point.datum;
      const key = xKey(point.xValue);
      const group = scenePoints.current.filter((p) => xKey(p.xValue) === key);
      showFocus(group.length > 0 ? group : [point]);
    },
    [showFocus],
  );

  const release = useCallback(() => {
    lastFocus.current = undefined;
    interaction.current?.setControlledFocus(null as never);
    showFocus([]);
  }, [showFocus]);

  const pointerProps = useMemo(
    () => ({
      onPointerDown: (event: React.PointerEvent) => {
        if (event.pointerType === "mouse") {
          return;
        }
        touchId.current = event.pointerId;
        inspect(event);
        // Capture so a finger that slides past the plot's edge keeps scrubbing
        // instead of dropping the gesture. Best-effort: it throws if the
        // pointer is already gone, and losing capture only costs us the part of
        // a drag that leaves the element — never the inspection itself, which
        // is why it runs after.
        try {
          event.currentTarget.setPointerCapture?.(event.pointerId);
        } catch {
          // no active pointer to capture
        }
      },
      onPointerMove: (event: React.PointerEvent) => {
        if (
          event.pointerType === "mouse" ||
          touchId.current === event.pointerId
        ) {
          inspect(event);
        }
      },
      onPointerUp: (event: React.PointerEvent) => {
        if (
          event.pointerType !== "mouse" &&
          touchId.current === event.pointerId
        ) {
          touchId.current = null;
          release();
        }
      },
      onPointerCancel: (event: React.PointerEvent) => {
        if (touchId.current === event.pointerId) {
          touchId.current = null;
          release();
        }
      },
      onPointerLeave: (event: React.PointerEvent) => {
        if (event.pointerType === "mouse") {
          release();
        }
      },
    }),
    [inspect, release],
  );

  return {
    bandX,
    bandWidth,
    ruleX,
    plotTop,
    plotBottom,
    sceneWidth,
    hostWidth,
    pxPerUnit,
    pillX,
    pillHalf,
    tickScope,
    tickStyleRef,
    dayY,
    monthY,
    opacity,
    hostRef,
    labels,
    markers,
    markerValues,
    monthSegments: segments,
    tooltipX,
    tooltipWidth,
    panelOpacity,
    panelScale,
    panelSlide,
    tooltipSlots,
    onRender,
    onFocusChange,
    pointerProps,
  };
}

/**
 * Wraps a chart and draws the cursor over it.
 *
 * `children` is the chart itself; the wrapper is what the overlay measures and
 * reads the line geometry from, so the two must share a box.
 */
export function ChartHoverOverlay({
  controller,
  children,
  showRule = true,
  showPill = true,
  pillOffset = 0,
  dotScale = 1,
  surface = "var(--background)",
  tooltip,
}: {
  controller: ChartHoverOverlayController;
  children: React.ReactNode;
  /** Omit for a chart with no panel, like the sidebar sparkline. */
  tooltip?: TooltipContent;
  showRule?: boolean;
  showPill?: boolean;
  /** Distance from the wrapper's bottom edge to the pill, in px. */
  pillOffset?: number;
  /** Shrinks the marker for short charts, where full size crowds the plot. */
  dotScale?: number;
  /**
   * What the markers punch through.
   *
   * The page tone, not the tier the chart happens to sit on — the old chart's
   * `--chart-background`, which was white in light and near-black in dark
   * whatever was behind it. Handing it the dialog's own surface instead makes
   * the ring vanish into it in dark, where the tiers actually differ; the halo
   * is meant to hold the dot off the line, so it has to contrast with both.
   */
  surface?: string;
}) {
  return (
    // `touch-action: pan-y` hands horizontal drags to us while leaving vertical
    // scrolling to the browser: without it the page claims the gesture and
    // cancels the pointer part-way through a scrub. The old chart used `none`,
    // which also blocked scrolling over the chart — a worse trade on a phone,
    // where the sparkline sits in the middle of a long page.
    <div
      className={cn("relative touch-pan-y", controller.tickScope)}
      ref={controller.hostRef}
      {...controller.pointerProps}
    >
      {/* One rule per date label, generated when the chart renders. Empty on a
          chart with no axis (the sparkline). */}
      <style ref={controller.tickStyleRef} />
      {children}
      <Cursor
        controller={controller}
        dotScale={dotScale}
        showRule={showRule}
        surface={surface}
      />
      {tooltip && <TooltipPanel controller={controller} tooltip={tooltip} />}
      {/* The pill hangs past this box at the first and last column, so nothing
          here may clip: it spills into the padding of whatever the chart sits
          in, exactly as the old chart's did. What stops that from widening the
          page is the dialog and the card, both of which clip their own
          overflow — verified at phone width on both, since an overhanging
          absolute child otherwise widens the nearest scroll container and
          flicks a horizontal scrollbar mid-drag. */}
      {showPill && (
        <div className="pointer-events-none absolute inset-0">
          <DatePill controller={controller} pillOffset={pillOffset} />
        </div>
      )}
    </div>
  );
}

/**
 * The rule, the highlight band and the dots, in one SVG sharing the chart's
 * coordinate space.
 *
 * The band re-strokes each series through a moving window, so the segment under
 * the cursor stays at full strength while the rest of the line is dimmed by the
 * chart's own `HOVER_DIM` mark state. Its paths are cloned from the chart's own
 * `<path>` elements rather than rebuilt, which keeps the curve identical, and
 * `url(#…)` paints keep working because SVG resolves those against the
 * document, not the owning `<svg>`.
 */
function Cursor({
  controller,
  showRule,
  dotScale,
  surface,
}: {
  controller: ChartHoverOverlayController;
  showRule: boolean;
  dotScale: number;
  surface: string;
}) {
  const clipId = useId();
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Cloning happens when a hover starts rather than on render, because the
  // chart owns those paths and repaints them on resize and data change.
  useMotionValueEvent(controller.opacity, "change", (value) => {
    const svg = svgRef.current;
    const host = controller.hostRef.current;
    if (!svg || !host || value === 0) {
      return;
    }
    const viewBox = host.querySelector("svg.ts-chart")?.getAttribute("viewBox");
    if (viewBox && svg.getAttribute("viewBox") !== viewBox) {
      svg.setAttribute("viewBox", viewBox);
    }
    const group = svg.querySelector("[data-band-paths]");
    if (!group) {
      return;
    }
    group.replaceChildren(
      ...[...host.querySelectorAll("svg.ts-chart .ts-chart__line path")].map(
        (line) => {
          const clone = line.cloneNode(false) as SVGPathElement;
          // The lines paint through their edge-fade gradient; the band must not,
          // or the bright segment would fade out at either end of the plot
          // exactly where it is still describing a real point. The old chart
          // handed `SeriesHighlightLayer` the raw `stroke` for the same reason.
          // The mark's key carries the marker key as one of its segments
          // ("total:string:5:total:segment:0", "installs:string:2:s0:...").
          const segments = (line.getAttribute("data-ts-key") ?? "").split(":");
          const marker = controller.markers.find((candidate) =>
            segments.includes(candidate.key),
          );
          if (marker) {
            clone.setAttribute("stroke", marker.color);
          }
          clone.removeAttribute("data-ts-key");
          // Both channels: the band is the trace at full strength, and it is
          // cloned from a line that is already dimmed. `stroke-opacity` is the
          // one the dim actually uses (`HOVER_DIM`) — leaving it on made the
          // highlight 50% of the series colour, which reads as a wash rather
          // than as the bright segment it is meant to be.
          clone.removeAttribute("opacity");
          clone.removeAttribute("stroke-opacity");
          return clone;
        },
      ),
    );
  });

  return (
    <motion.svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      preserveAspectRatio="none"
      ref={svgRef}
      style={{ opacity: controller.opacity }}
    >
      <defs>
        <clipPath id={clipId}>
          <motion.rect
            height="100%"
            width={controller.bandWidth}
            x={controller.bandX}
            y={0}
          />
        </clipPath>
      </defs>
      {showRule && (
        <motion.line
          stroke="var(--primary)"
          strokeOpacity={0.6}
          strokeWidth={1}
          x1={controller.ruleX}
          x2={controller.ruleX}
          y1={controller.plotTop}
          y2={controller.plotBottom}
        />
      )}
      <g clipPath={`url(#${clipId})`} data-band-paths />
      {controller.markers.slice(0, MAX_MARKERS).map((marker, i) => (
        <Dot
          color={marker.color}
          key={marker.key}
          scale={dotScale}
          surface={surface}
          values={controller.markerValues[i]}
        />
      ))}
    </motion.svg>
  );
}

/**
 * A disc of the series colour inside a ring of the surface, which is what holds
 * it off a line or a bar of the same hue. Every series wears the same one — the
 * marker says "the value here", and that does not change with the mark drawing
 * it.
 */
function Dot({
  color,
  scale,
  surface,
  values,
}: {
  color: string;
  scale: number;
  surface: string;
  values: MarkerValues;
}) {
  return (
    <motion.g style={{ opacity: values.opacity }}>
      <motion.circle
        cx={values.cx}
        cy={values.cy}
        fill={color}
        r={DOT_RADIUS * scale}
        stroke={surface}
        strokeWidth={DOT_STROKE_WIDTH * scale}
      />
    </motion.g>
  );
}

/**
 * The date under the cursor. Month and day scroll independently, so moving
 * across a month boundary rolls the month once while the day keeps ticking.
 */
function DatePill({
  controller,
  pillOffset,
}: {
  controller: ChartHoverOverlayController;
  pillOffset: number;
}) {
  const { days } = useMemo(
    () => splitLabels(controller.labels),
    [controller.labels],
  );
  const compact = controller.labels.length > DISCRETE_THRESHOLD;

  // The pill stays centred on its column the whole way across, including the
  // first and last, which means it hangs past the plot at both ends — as the
  // old chart's did. Clamping it inside instead is worse than the overhang: it
  // decouples the pill from the mark it is labelling exactly where the mark is
  // easiest to point at.
  //
  // Its width is still measured, for the label fade (`paintTickFade`) and for
  // the tooltip. By observer rather than read in a transform: transforms run
  // per frame, and `offsetWidth` there would force a layout on each one.
  const pillRef = useRef<HTMLDivElement | null>(null);
  const pillHalf = controller.pillHalf;
  useEffect(() => {
    const el = pillRef.current;
    if (!el) {
      return;
    }
    const measure = () => pillHalf.set(el.offsetWidth / 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [pillHalf]);

  // The offset is expressed in the same scene units as the axis margins it is
  // derived from, so it scales with them.
  const bottom = useTransform(
    controller.pxPerUnit,
    (scale) => pillOffset * scale,
  );

  return (
    <motion.div
      aria-hidden="true"
      className="pointer-events-none absolute z-20 -translate-x-1/2"
      style={{ left: controller.pillX, bottom, opacity: controller.opacity }}
    >
      {/* The pill is opaque and sits on the tick-label row, so it hides the
          label it is standing on. Its neighbours are further apart than it is
          wide (see `AXIS_TICK_LABELS.thin`), so there is nothing to fade: the
          label under the cursor is covered whole, and the next one along is
          clear of the pill entirely.

          It used to sit on a feathered strip of the chart's surface, to stand
          in for the old chart's fading of the labels themselves — which is not
          reproducible here, since the chart strips inline styles off its own
          nodes on every repaint. The strip read as a bar of blank surface
          sweeping the axis, worst on a phone where it spanned much of the
          width. Overlapping nothing is better than covering it up. */}
      {/* The panel's surface, so the two read as one instrument. The old chart
          inverted the pill instead (`bg-zinc-900` / `dark:bg-zinc-100`), which
          left it near-white in dark against a near-black panel.

          It keeps a shadow where the panel has none, because unlike the panel
          this one sits ON the plot. `sm` rather than the old pill's `lg`: the
          pill is aligned to the tick-label row, ~3px off the bottom of the
          chart box, and the dialog's scrollable body ends ~7px below that.
          `shadow-lg` reaches about 22px and was cut off square there — on the
          old chart too. `sm` reaches ~4px and fits. */}
      <div
        className="overflow-hidden rounded-full bg-chrome px-4 py-1 text-foreground shadow-sm"
        data-surface="chrome"
        ref={pillRef}
      >
        {compact ? (
          <CompactLabel controller={controller} />
        ) : (
          <div className="flex h-6 items-center justify-center gap-1">
            <Track
              items={controller.monthSegments.map((s) => s.month)}
              y={controller.monthY}
            />
            <Track items={days} y={controller.dayY} />
          </div>
        )}
      </div>
    </motion.div>
  );
}

function Track({
  items,
  y,
}: {
  items: readonly string[];
  y: MotionValue<number>;
}) {
  return (
    <div className="relative h-6 overflow-hidden">
      <motion.div className="flex flex-col" style={{ y }}>
        {items.map((item, i) => (
          <div
            className="flex h-6 shrink-0 items-center justify-center"
            key={`${item}-${i}`}
          >
            <span className="text-sm font-medium whitespace-nowrap">
              {item}
            </span>
          </div>
        ))}
      </motion.div>
    </div>
  );
}

/**
 * Long series skip the scroll: a stack of hundreds of days is a lot of DOM to
 * animate for a label that would blur past anyway.
 */
function CompactLabel({
  controller,
}: {
  controller: ChartHoverOverlayController;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  // Through a ref for the same reason as the tooltip's: the listener registered
  // on mount keeps its original closure, and the labels grow with the data.
  const labels = useRef(controller.labels);
  labels.current = controller.labels;

  useMotionValueEvent(controller.dayY, "change", (value) => {
    const index = Math.round(-value / TICKER_ITEM_HEIGHT);
    const label = labels.current[index];
    if (ref.current && label) {
      ref.current.textContent = label;
    }
  });
  return (
    <span
      className="flex h-6 items-center text-sm font-medium whitespace-nowrap"
      ref={ref}
    />
  );
}

interface TooltipSlots {
  title: HTMLElement | null;
  rows: Map<string, HTMLElement>;
  values: Map<string, HTMLElement>;
  content: TooltipContent | null;
  markers: readonly HoverMarker[];
}

/** Writes the focused day and its per-series values into the panel. */
function paintTooltip(
  slots: TooltipSlots,
  index: number,
  points: readonly FocusedPoint[],
) {
  const { content } = slots;
  if (!content) {
    return;
  }
  if (slots.title) {
    slots.title.textContent = content.title(index);
  }
  for (const marker of slots.markers) {
    const point = points.find(
      (candidate) => String(candidate.group ?? candidate.markId) === marker.key,
    );
    const row = slots.rows.get(marker.key);
    if (row) {
      row.hidden = !point;
    }
    const value = slots.values.get(marker.key);
    if (value && point) {
      value.textContent = content.value(point, marker);
    }
  }
}

export interface TooltipContent {
  /** Heading for the focused column, by its index along the x axis. */
  title: (index: number) => string;
  /** Row value for one focused point. */
  value: (point: { datum: unknown }, marker: HoverMarker) => string;
}

/**
 * The hover panel.
 *
 * Ours rather than the chart's because the built-in one clamps itself into the
 * chart box: where the panel does not fit beside the cursor it slides back over
 * it, covering the marker it is describing. That clamping cannot be turned off.
 * The old chart hung off the edge instead, and this reproduces that.
 *
 * Its contents are written imperatively for the same reason the rest of the
 * overlay is: React state here would re-render the chart on every pointer move
 * and cancel its motion. The row structure is fixed — one per series — so only
 * the text ever changes.
 */
function TooltipPanel({
  controller,
  tooltip,
}: {
  controller: ChartHoverOverlayController;
  tooltip: TooltipContent;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // The panel hands its nodes and the current adapter to the controller, and
  // `showFocus` writes them directly. Registering on every render keeps the
  // adapter fresh — it closes over data that arrives after mount.
  controller.tooltipSlots.current.content = tooltip;
  controller.tooltipSlots.current.markers = controller.markers;

  useEffect(() => {
    const el = panelRef.current;
    if (!el) {
      return;
    }
    const measure = () => controller.tooltipWidth.set(el.offsetWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [controller.tooltipWidth]);

  // `plotTop` is a scene value and this panel is HTML, so it converts like the
  // pill's x does.
  const top = useTransform(
    [controller.plotTop, controller.pxPerUnit],
    ([y, scale]: number[]) => y * scale,
  );

  return (
    <motion.div
      aria-hidden="true"
      className="pointer-events-none absolute z-10"
      style={{
        left: controller.tooltipX,
        top,
        opacity: controller.panelOpacity,
        scale: controller.panelScale,
        x: controller.panelSlide,
      }}
    >
      {/* The chrome surface, matching the tooltip component's `chrome` variant:
          the same near-black fill in both themes, with `data-surface` re-pointing
          --foreground / --muted-foreground / --border onto it so the row labels
          read correctly against it. It also puts the panel and the date pill on
          the same material, which is what they were on the old chart.

          Fill only, like the variant: `--chrome-shadow` is its opt-in edge, for
          a header bar rather than a label.

          The radius is the old chart's `rounded-lg` (12px), not the variant's
          `rounded-sm` (8px): this is a two-row data panel about 190px wide, not
          the one-line label that variant is sized for. */}
      <div
        className="min-w-[9rem] overflow-hidden rounded-lg bg-chrome px-3 py-2.5 text-foreground"
        data-surface="chrome"
        ref={panelRef}
        style={{
          // Capped so it always fits beside the cursor. Below roughly twice its
          // width the chart has no room either side, and the panel would hang
          // off far enough to be cut by whatever the chart sits in. The rows
          // wrap at that point, which is the trade: a taller panel next to the
          // marker beats a wider one sliced by the card's edge.
          maxWidth: "min(16rem, calc(50vw - 3.5rem))",
        }}
      >
        <div
          className="mb-2 text-xs font-medium"
          ref={(el) => {
            controller.tooltipSlots.current.title = el;
          }}
        />
        <div className="space-y-1.5">
          {controller.markers.map((marker) => (
            <div
              className="flex items-center justify-between gap-4"
              key={marker.key}
              ref={(el) => {
                if (el) {
                  controller.tooltipSlots.current.rows.set(marker.key, el);
                }
              }}
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
              <span
                className="shrink-0 text-sm font-medium tabular-nums"
                ref={(el) => {
                  if (el) {
                    controller.tooltipSlots.current.values.set(marker.key, el);
                  }
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
