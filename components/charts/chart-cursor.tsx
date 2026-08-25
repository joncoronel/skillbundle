"use client";

import { useId, useRef } from "react";
import { motion, useMotionValueEvent } from "motion/react";
import {
  DOT_RADIUS,
  DOT_STROKE_WIDTH,
  MAX_MARKERS,
  type ChartHoverOverlayController,
  type MarkerValues,
} from "./use-chart-hover-overlay";

/**
 * The highlight band and the dots, in one SVG sharing the chart's coordinate
 * space. The rule is not here: it is the library's `crosshair` mark, drawn
 * into the chart's own SVG by `focus-crosshair.ts`.
 *
 * The band re-strokes each series through a moving window, so the segment under
 * the cursor stays at full strength while the rest of the line is dimmed by the
 * chart's own `HOVER_DIM` mark state. Its paths are cloned from the chart's own
 * `<path>` elements rather than rebuilt, which keeps the curve identical, and
 * `url(#…)` paints keep working because SVG resolves those against the
 * document, not the owning `<svg>`.
 */
export function Cursor({
  controller,
  dotScale,
  surface,
}: {
  controller: ChartHoverOverlayController;
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
