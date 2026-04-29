"use client";

import { type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import "@/components/ui/dot-matrix-ripple.css";

type LoaderPreset = "xs" | "sm" | "md" | "lg";

interface DotMatrixRippleProps {
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

const ORIGIN_ROW = 2;
const ORIGIN_COL = 2;
const MAX_MANHATTAN = 4;

type CellKind = "corner" | "active";
interface Cell {
  kind: CellKind;
  ring: number;
}

const CELLS: Cell[] = (() => {
  const cells: Cell[] = [];
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const isCorner = (row === 0 || row === 4) && (col === 0 || col === 4);
      const ring = Math.min(
        MAX_MANHATTAN,
        Math.abs(row - ORIGIN_ROW) + Math.abs(col - ORIGIN_COL),
      );
      cells.push({ kind: isCorner ? "corner" : "active", ring });
    }
  }
  return cells;
})();

export function DotMatrixRipple({
  size = "md",
  className,
  ariaLabel = "Loading",
  speed = 1.35,
}: DotMatrixRippleProps) {
  const { px, dotPx } = PRESETS[size];
  const safeSpeed = speed > 0 ? speed : 1;
  const gap = Math.max(1, Math.floor((px - dotPx * 5) / 4));

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
      className={cn("dmxr-loader", className)}
      style={
        {
          width: px,
          height: px,
          "--dmxr-speed": safeSpeed,
        } as CSSProperties
      }
    >
      <span
        className="dmxr-grid"
        style={{ width: px, height: px, gap }}
      >
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
              className="dmxr-dot"
              style={
                {
                  width: dotPx,
                  height: dotPx,
                  "--dmxr-ring": cell.ring,
                } as CSSProperties
              }
            />
          );
        })}
      </span>
    </span>
  );
}
