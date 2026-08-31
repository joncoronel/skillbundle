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

/**
 * Optical correction, not decoration: the glyph ships at 1.5 and a 1.5 stroke
 * on a 16px arc reads as a grey smudge rather than a line. Weight goes up as
 * the box goes down.
 */
const STROKE: Record<SpinnerSize, number> = {
  xs: 2.5,
  sm: 2.25,
  md: 2,
  lg: 1.75,
};

/**
 * The app's single loading indicator.
 *
 * **It is decorative and announces nothing.** `aria-hidden` is deliberate, not
 * an oversight: a status node that mounts already holding its label has not
 * changed, so it never announces, and inside a `<button>` it is pruned outright
 * (`components/ui/cubby-ui/button.tsx` documents that at its own loading slot).
 * The surface owns the announcement — `aria-busy` on the control, or a
 * persistently mounted `LiveStatus` (`components/ui/live-status.tsx`) beside
 * it. Do not give this component an `ariaLabel` prop back.
 *
 * The glyph is `LoaderCircle` — eight evenly spaced spokes. Under a continuous
 * `animate-spin` a spoke wheel reads as turning even though you cannot tell one
 * spoke from another; what it will NOT survive is a stepped animation, where a
 * 45-degree tick maps the shape exactly onto itself and the thing sits dead
 * still. Keep the rotation continuous, or give the spokes a trailing opacity
 * ramp first.
 *
 * Under `prefers-reduced-motion` it pulses instead of freezing. The loaders
 * this replaced held a static opacity gradient when stopped, so they still read
 * as busy; eight identical spokes stopped dead read as an ordinary icon, and at
 * the two search fields the spinner swaps in for the search glyph with no text
 * beside it.
 *
 * Sizes are Tailwind classes rather than inline width/height so a caller's
 * `className` can override them through `cn`'s tailwind-merge — the loader
 * this replaced set inline styles, which silently beat the `size-4` one call
 * site was passing.
 *
 * There is no wrapper element. `HugeiconsIcon` spreads its rest props onto the
 * `<svg>` it renders, so role, label and classes all land there directly, and
 * an `<svg>` under Tailwind's preflight is already `display: block` with a
 * centred `transform-origin` — it rotates correctly on its own. A host `<span>`
 * would need `inline-flex` just to take a size, plus `size-full` on the icon to
 * fill it, to end up in the same place.
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
