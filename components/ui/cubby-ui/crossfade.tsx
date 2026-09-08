"use client";

import * as React from "react";
import { useAnimatedHeight } from "@/hooks/cubby-ui/use-animated-height";
import { cn } from "@/lib/utils";

const CROSSFADE_BASE = cn(
  "transition-[opacity,filter,translate,display] duration-240 ease-[cubic-bezier(0.32,0.72,0,1)] transition-discrete",
  "motion-reduce:transition-none",
);

const CROSSFADE_STARTING = "starting:opacity-0 starting:blur-sm";

// The starting slide sets `translate` directly rather than through Tailwind's
// `translate-y-*`, which routes via the `@property`-registered `--tw-translate-y`.
// `transition-panel.tsx` documents WebKit dropping an `@starting-style` value on a
// registered custom property that holds a `var()` reference, falling back to
// `initial-value: 0` and losing the slide.
//
// WebKit 26.5 animates both forms identically, so this was fixed upstream at some
// point. That is not a reason to go back: Safari ships with the OS, so the installs
// that still have the bug are exactly the ones that never update. The literal costs
// nothing and works in every engine, so leave it. Do not "simplify" it back to
// `translate-y-*` on the strength of a current-Safari test.
// 0.75rem is `translate-y-3` on the default spacing scale.

export function Crossfade({
  active,
  children,
}: {
  active: boolean;
  children: [React.ReactNode, React.ReactNode];
}) {
  const { outerRef, innerRef } = useAnimatedHeight();
  const [first, second] = children;

  // Withhold @starting-style until `active` has actually flipped once.
  //
  // Both panels are always in the DOM and the inactive one is `display: none`,
  // so the entering panel is newly rendered on every flip — and on first mount,
  // where an entrance is wrong and `starting:translate-*` would wrap a skeleton
  // in a transform context that desyncs `bg-fixed`. Deriving the flag during
  // render turns it on in the same commit as the `display` change. A mount
  // effect cannot match that even deferred through rAF: React flushes passive
  // effects synchronously when another update arrives first, so the classes
  // could land before the browser had resolved style for the new subtree, and
  // @starting-style would still apply.
  const [previousActive, setPreviousActive] = React.useState(active);
  const [hasToggled, setHasToggled] = React.useState(false);
  if (active !== previousActive) {
    setPreviousActive(active);
    setHasToggled(true);
  }

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
            hasToggled && CROSSFADE_STARTING,
            hasToggled && "starting:[translate:0_0.75rem]",
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
            hasToggled && CROSSFADE_STARTING,
            hasToggled && "starting:[translate:0_-0.75rem]",
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
