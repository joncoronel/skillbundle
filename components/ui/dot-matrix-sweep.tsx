"use client";

import { type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import "@/components/ui/dot-matrix-sweep.css";

type LoaderPreset = "xs" | "sm" | "md" | "lg";

interface DotMatrixSweepProps {
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

const MAX_SLICE = 8;

type CellKind = "corner" | "active";
interface Cell {
  kind: CellKind;
  path: number;
  parity: number;
}

const CELLS: Cell[] = (() => {
  const cells: Cell[] = [];
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const isCorner = (row === 0 || row === 4) && (col === 0 || col === 4);
      const slice = row + (4 - col);
      cells.push({
        kind: isCorner ? "corner" : "active",
        path: slice / MAX_SLICE,
        parity: slice % 2,
      });
    }
  }
  return cells;
})();

export function DotMatrixSweep({
  size = "md",
  className,
  ariaLabel = "Loading",
  speed = 1.1,
}: DotMatrixSweepProps) {
  const { px, dotPx } = PRESETS[size];
  const safeSpeed = speed > 0 ? speed : 1;
  const gap = Math.max(1, Math.floor((px - dotPx * 5) / 4));

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
      className={cn("dmxs-loader", className)}
      style={
        {
          width: px,
          height: px,
          "--dmxs-speed": safeSpeed,
        } as CSSProperties
      }
    >
      <span className="dmxs-grid" style={{ width: px, height: px, gap }}>
        {CELLS.map((cell, i) => {
          if (cell.kind === "corner") {
            return (
              <span key={i} aria-hidden style={{ visibility: "hidden" }} />
            );
          }
          return (
            <span
              key={i}
              aria-hidden
              className="dmxs-dot"
              style={
                {
                  width: dotPx,
                  height: dotPx,
                  "--dmxs-path": cell.path,
                  "--dmxs-parity": cell.parity,
                } as CSSProperties
              }
            />
          );
        })}
      </span>
    </span>
  );
}
