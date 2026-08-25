"use client";

import { useCallback, useEffect, useId, useMemo, useRef } from "react";
import {
  useMotionValue,
  useReducedMotion,
  useSpring,
  type MotionValue,
} from "motion/react";
import {
  FOCUS_SPRING,
  HIGHLIGHT_SPRING,
  useCoarsePointer,
} from "./chart-motion";

// The state behind the cursor: the controller every chart builds, the pointer
// gesture, the geometry it measures once per render, and `showFocus`, which
// paints a focus change straight onto MotionValues.
//
// The views that read this controller are `chart-cursor.tsx` and
// `chart-date-pill.tsx`; `chart-hover-overlay.tsx` is the wrapper that puts
// them over a chart. See that file for what the overlay draws and why.

export const TICKER_ITEM_HEIGHT = 24;

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
export const DISCRETE_THRESHOLD = 60;

/**
 * Marker springs are allocated up front because hooks cannot be created in a
 * loop over a list that changes length — the compare page's series count moves
 * as columns are added and removed. Three is that page's column cap, and the
 * most any of our charts needs.
 */
export const MAX_MARKERS = 3;

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

export const DOT_RADIUS = 5;
export const DOT_STROKE_WIDTH = 2;

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

/**
 * Anything the renderer hands us that carries a mark identity.
 *
 * Both shapes flow through here: the overlay's own `FocusedPoint`, and the
 * library `ChartPoint`s `renderTooltipBody` is given.
 */
interface MarkIdentified {
  readonly group?: unknown;
  readonly markId?: unknown;
}

/**
 * The scene point a marker describes, or `undefined` when that series has no
 * value at this x.
 *
 * A mark's group is its series identity, and a mark declared without a `z`
 * falls back to its mark id (the sparkline's single line). This lived in three
 * files at once — here, and both charts' tooltip bodies — which is a bad place
 * for it: changing how group identity is assigned and missing one silently
 * drops a dot or a tooltip row instead of failing.
 */
export function pointForMarker<T extends MarkIdentified>(
  points: readonly T[],
  marker: HoverMarker,
) {
  return points.find(
    (candidate) => String(candidate.group ?? candidate.markId) === marker.key,
  );
}

export interface MarkerValues {
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
  /** CSS pixels per scene unit. */
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
export function splitLabels(labels: readonly string[]) {
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
  const pillX = useSpring(0, focus);
  const dayY = useSpring(0, focus);
  const monthY = useSpring(0, focus);
  const opacity = useMotionValue(0);
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
  }, [pxPerUnit, tickScope]);

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
      samples.current = null;
      // After paint, not now: `onRender` runs with the scene in hand but before
      // the markup it describes is in the DOM, so measuring here reads the
      // PREVIOUS render's axis. On a chart whose data arrives late that is the
      // difference between labels that fade and labels that never do.
      cancelAnimationFrame(measureFrame.current);
      measureFrame.current = requestAnimationFrame(measureScale);
    },
    [measureScale],
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
        wasActive.current = false;
        return;
      }
      if (samples.current?.d !== linePath) {
        samples.current = { d: linePath, xs: samplePositions(linePath) };
      }
      const xs = samples.current.xs;
      if (xs.length === 0) {
        opacity.set(0);
        wasActive.current = false;
        return;
      }

      const x = points[0].x;
      const index = nearestIndex(xs, x);
      const bandStart = xs[Math.max(0, index - 1)];
      const bandEnd = xs[Math.min(xs.length - 1, index + 1)];

      // Jump on the first frame of a hover so everything appears around the
      // cursor instead of sweeping in from the left edge; ease after that.
      const entering = !wasActive.current;
      // The band, the markers and the panel travel at any density — only
      // reduced motion stops them. The band lived in the old chart's line
      // layer, not its tooltip, and took no `animate` flag at all. The rule
      // itself is the library's `crosshair` now (see `focus-crosshair.ts`), and
      // carries the density gate in its own `motion`.
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

      // The pill is HTML: it takes CSS pixels, not scene units.
      const cssX = x * pxPerUnit.get();

      writeTravelling(bandX, Math.min(bandStart, bandEnd));
      writeTravelling(bandWidth, Math.abs(bandEnd - bandStart));
      writePill(pillX, cssX);
      paintTickFade(cssX);
      writePill(dayY, -index * TICKER_ITEM_HEIGHT);
      writePill(monthY, -(segmentOfIndex[index] ?? 0) * TICKER_ITEM_HEIGHT);

      for (const [i, config] of markers.slice(0, MAX_MARKERS).entries()) {
        const values = markerValues[i];
        const point = pointForMarker(points, config);
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
      pillX,
      dayY,
      monthY,
      opacity,
      segmentOfIndex,
      markers,
      markerValues,
      pxPerUnit,
      pillHalf,
      paintTickFade,
      stillCursor,
      reducedMotion,
      coarse,
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
        if (event.pointerType !== "mouse") {
          return;
        }
        // A hovering mouse leaving says nothing about where KEYBOARD focus is.
        // The chart paints its own focus indicator — the rule, the marker, the
        // dimmed bars — precisely so the browser's ring around a 600px box can
        // stay off, and clearing here would strip that while the element is
        // still focused, leaving nothing drawn at all. Measured before this
        // guard: tab into the chart, sweep a mouse across it and away, and
        // focus sat on the SVG with every bar back at full strength.
        //
        // `:focus-visible` is the right test rather than `:focus`, because it
        // is false after a plain click here (measured) — so a mouse user who
        // clicked the chart still gets the clear they expect.
        if (
          hostRef.current
            ?.querySelector("svg.ts-chart")
            ?.matches(":focus-visible")
        ) {
          return;
        }
        release();
      },
    }),
    [inspect, release],
  );

  return {
    bandX,
    bandWidth,
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
