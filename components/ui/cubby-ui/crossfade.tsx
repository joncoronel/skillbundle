"use client";

import * as React from "react";
import { useAnimatedHeight } from "@/hooks/cubby-ui/use-animated-height";
import { cn } from "@/lib/utils";

const CROSSFADE_BASE = cn(
  "transition-[opacity,filter,translate,display] duration-240 ease-[cubic-bezier(0.32,0.72,0,1)] transition-discrete",
  "motion-reduce:transition-none",
);

const CROSSFADE_STARTING = "starting:opacity-0 starting:blur-sm";

export function Crossfade({
  active,
  children,
}: {
  active: boolean;
  children: [React.ReactNode, React.ReactNode];
}) {
  const { outerRef, innerRef } = useAnimatedHeight();
  const [first, second] = children;

  // Skip @starting-style on initial mount so skeletons render without
  // a transform context that breaks bg-fixed animation sync.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  return (
    <div
      ref={outerRef}
      className="transition-[height] duration-270 ease-[cubic-bezier(0.32,0.72,0,1)]"
    >
      <div ref={innerRef} className="grid">
        <div
          className={cn(
            "[grid-area:1/1]",
            CROSSFADE_BASE,
            mounted && CROSSFADE_STARTING,
            mounted && "starting:translate-y-3",
            active
              ? "contain-[size] hidden opacity-0 blur-sm translate-y-3 pointer-events-none"
              : "opacity-100",
          )}
          aria-hidden={active}
        >
          {first}
        </div>

        <div
          className={cn(
            "[grid-area:1/1]",
            CROSSFADE_BASE,
            mounted && CROSSFADE_STARTING,
            mounted && "starting:-translate-y-3",
            active
              ? "opacity-100"
              : "contain-[size] hidden opacity-0 blur-sm -translate-y-3 pointer-events-none",
          )}
          aria-hidden={!active}
        >
          {second}
        </div>
      </div>
    </div>
  );
}
