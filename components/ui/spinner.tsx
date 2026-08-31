import { HugeiconsIcon } from "@hugeicons/react";
import { LoaderCircle } from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";

type SpinnerSize = "xs" | "sm" | "md" | "lg";

interface SpinnerProps {
  size?: SpinnerSize;
  className?: string;
}

const SIZES: Record<SpinnerSize, string> = {
  xs: "size-4",
  sm: "size-[18px]",
  md: "size-7",
  lg: "size-10",
};

/** Optical correction: a 1.5 stroke on a 16px arc reads as a smudge, not a
 *  line. Weight goes up as the box goes down. */
const STROKE: Record<SpinnerSize, number> = {
  xs: 2.5,
  sm: 2.25,
  md: 2,
  lg: 1.75,
};

/**
 * The app's single loading indicator.
 *
 * **Decorative: it announces nothing, and must not gain an `ariaLabel`.** A
 * status node that mounts already holding its label never announces, and inside
 * a `<button>` it is pruned outright. The surface owns that instead —
 * `aria-busy` on the control, or a mounted `LiveStatus` beside it.
 *
 * Keep the rotation continuous. `LoaderCircle` is eight evenly spaced spokes,
 * so a stepped animation ticks the shape onto its own symmetry and it sits
 * dead still.
 *
 * Sizes are classes, not inline width/height, so a caller's `className` can
 * override them through tailwind-merge.
 */
export function Spinner({ size = "xs", className }: SpinnerProps) {
  return (
    <HugeiconsIcon
      icon={LoaderCircle}
      strokeWidth={STROKE[size]}
      aria-hidden
      className={cn(
        "shrink-0 animate-spin motion-reduce:animate-pulse",
        SIZES[size],
        className,
      )}
    />
  );
}
