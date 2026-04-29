"use client";

import { type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import "@/components/ui/dot-matrix-comet.css";

type LoaderPreset = "xs" | "sm" | "md" | "lg";

interface DotMatrixCometProps {
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

export function DotMatrixComet({
  size = "md",
  className,
  ariaLabel = "Loading",
  speed = 1.6,
}: DotMatrixCometProps) {
  const { px, dotPx } = PRESETS[size];
  const safeSpeed = speed > 0 ? speed : 1;
  const gap = Math.max(1, Math.floor((px - dotPx * 5) / 4));

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
      className={cn("dmxc-loader", className)}
      style={
        {
          width: px,
          height: px,
          "--dmxc-speed": safeSpeed,
        } as CSSProperties
      }
    >
      <span
        className="dmxc-grid"
        style={{ width: px, height: px, gap }}
      >
        {CELLS.map((cell, i) => {
          if (cell.kind === "corner") {
            return (
              <span key={i} aria-hidden style={{ visibility: "hidden" }} />
            );
          }
          if (cell.kind === "ring") {
            return (
              <span
                key={i}
                aria-hidden
                className="dmxc-dot dmxc-ring"
                style={
                  {
                    width: dotPx,
                    height: dotPx,
                    "--dmxc-ring-pos": cell.ringIndex,
                  } as CSSProperties
                }
              />
            );
          }
          return (
            <span
              key={i}
              aria-hidden
              className="dmxc-dot"
              style={{
                width: dotPx,
                height: dotPx,
                opacity: cell.kind === "core" ? CORE_OPACITY : INNER_OPACITY,
              }}
            />
          );
        })}
      </span>
    </span>
  );
}
