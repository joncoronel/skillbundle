"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

type LoaderPreset = "xs" | "sm" | "md" | "lg";

interface DotMatrixLoaderProps {
  size?: LoaderPreset;
  className?: string;
  ariaLabel?: string;
  speed?: number;
}

const PRESETS: Record<LoaderPreset, { px: number; dotPx: number }> = {
  xs: { px: 14, dotPx: 2 },
  sm: { px: 18, dotPx: 2 },
  md: { px: 28, dotPx: 4 },
  lg: { px: 40, dotPx: 5 },
};

const STEP_COUNT = 24;
const CYCLE_MS_BASE = 1650;
const RING_LEN = 12;
const COMET_TAIL = [1, 0.78, 0.56, 0.36, 0.22] as const;
const SECONDARY_COMET_SCALE = 0.72;
const RING_BASE_OPACITY = 0.2;
const RING_GRADIENT_RANGE = 0.56;
const INNER_OPACITY = 0.08;
const CORE_OPACITY = 0.16;

type CellKind = "corner" | "core" | "inner" | "ring";
interface Cell {
  kind: CellKind;
  ringIndex: number;
}

const CELLS: Cell[] = (() => {
  const ringPath: Array<[number, number]> = [
    [0, 1], [0, 2], [0, 3],
    [1, 4], [2, 4], [3, 4],
    [4, 3], [4, 2], [4, 1],
    [3, 0], [2, 0], [1, 0],
  ];
  const ringIndexAt = (row: number, col: number) =>
    ringPath.findIndex(([r, c]) => r === row && c === col);

  const cells: Cell[] = [];
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const isCorner = (row === 0 || row === 4) && (col === 0 || col === 4);
      const isOuter = row === 0 || row === 4 || col === 0 || col === 4;
      const isCenter = row === 2 && col === 2;
      if (isCorner) {
        cells.push({ kind: "corner", ringIndex: -1 });
      } else if (isOuter) {
        cells.push({ kind: "ring", ringIndex: ringIndexAt(row, col) });
      } else if (isCenter) {
        cells.push({ kind: "core", ringIndex: -1 });
      } else {
        cells.push({ kind: "inner", ringIndex: -1 });
      }
    }
  }
  return cells;
})();

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function useCometStep(active: boolean, cycleMs: number): number {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!active) return;
    const stepMs = cycleMs / STEP_COUNT;
    const start = performance.now();
    let raf = 0;
    let last = -1;
    const tick = (now: number) => {
      const elapsed = now - start;
      const next = Math.floor((elapsed % cycleMs) / stepMs) % STEP_COUNT;
      if (next !== last) {
        last = next;
        setStep(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, cycleMs]);
  return step;
}

function cometOpacity(ringIndex: number, leadA: number, leadB: number): number {
  let opacity = INNER_OPACITY;
  for (let i = 0; i < COMET_TAIL.length; i += 1) {
    const weight = COMET_TAIL[i];
    const tailA = (leadA - i + RING_LEN) % RING_LEN;
    const tailB = (leadB - i + RING_LEN) % RING_LEN;
    if (ringIndex === tailA) opacity = Math.max(opacity, weight);
    if (ringIndex === tailB) opacity = Math.max(opacity, weight * SECONDARY_COMET_SCALE);
  }
  return Math.min(1, opacity);
}

export function DotMatrixLoader({
  size = "md",
  className,
  ariaLabel = "Loading",
  speed = 1.6,
}: DotMatrixLoaderProps) {
  const { px, dotPx } = PRESETS[size];
  const reducedMotion = usePrefersReducedMotion();
  const safeSpeed = speed > 0 ? speed : 1;
  const step = useCometStep(!reducedMotion, CYCLE_MS_BASE / safeSpeed);

  const leadA = Math.floor((step / STEP_COUNT) * RING_LEN) % RING_LEN;
  const leadB = (leadA + RING_LEN / 2) % RING_LEN;
  const gap = Math.max(1, Math.floor((px - dotPx * 5) / 4));

  const gridStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
    gridTemplateRows: "repeat(5, minmax(0, 1fr))",
    width: px,
    height: px,
    gap,
  };

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center justify-center align-middle text-current",
        className,
      )}
      style={{ width: px, height: px }}
    >
      <span style={gridStyle}>
        {CELLS.map((cell, i) => {
          if (cell.kind === "corner") {
            return <span key={i} aria-hidden style={{ visibility: "hidden" }} />;
          }
          let opacity: number;
          if (cell.kind === "core") {
            opacity = CORE_OPACITY;
          } else if (cell.kind === "inner") {
            opacity = INNER_OPACITY;
          } else if (reducedMotion) {
            opacity = RING_BASE_OPACITY + (cell.ringIndex / (RING_LEN - 1)) * RING_GRADIENT_RANGE;
          } else {
            opacity = cometOpacity(cell.ringIndex, leadA, leadB);
          }
          return (
            <span
              key={i}
              aria-hidden
              style={{
                width: dotPx,
                height: dotPx,
                background: "currentColor",
                borderRadius: 999,
                opacity,
              }}
            />
          );
        })}
      </span>
    </span>
  );
}
