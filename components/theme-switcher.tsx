"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Sun02Icon,
  Moon02Icon,
  ComputerIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/cubby-ui/button";

const CYCLE = ["light", "dark", "system"] as const;
const LABELS: Record<string, string> = {
  light: "Switch to dark theme",
  dark: "Switch to system theme",
  system: "Switch to light theme",
};

const subscribe = () => () => {};
const useMounted = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

export function ThemeSwitcher() {
  const { setTheme, theme } = useTheme();
  const mounted = useMounted();

  function cycleTheme() {
    const current = CYCLE.indexOf(theme as (typeof CYCLE)[number]);
    const next = CYCLE[(current + 1) % CYCLE.length];
    setTheme(next);
  }

  // Before mount, default to the "system" icon so the button isn't empty
  // during the hydration window on client-side navigation.
  const active = mounted ? theme : "system";

  return (
    <Button
      onClick={cycleTheme}
      aria-label={mounted ? LABELS[theme ?? "system"] : "Toggle theme"}
      variant="ghost"
      size="icon_sm"
    >
      {/* Stack the three icons in a single grid cell so they overlap and
          crossfade. Owned here (not via the button's children wrapper, which
          no longer stacks its children). */}
      <span className="relative grid size-4 place-items-center *:[grid-area:1/1]">
        {/* Light mode: sun */}
        <HugeiconsIcon
          icon={Sun02Icon}
          data-visible={active === "light" || undefined}
          className="motion-safe:transition-all! motion-safe:duration-200 motion-safe:rotate-90 motion-safe:scale-60 motion-safe:blur-xs opacity-0 data-visible:rotate-0 data-visible:scale-100 data-visible:blur-none data-visible:opacity-100"
          strokeWidth={2}
        />
        {/* Dark mode: moon */}
        <HugeiconsIcon
          icon={Moon02Icon}
          data-visible={active === "dark" || undefined}
          className="motion-safe:transition-all! motion-safe:duration-200 motion-safe:-rotate-90 motion-safe:scale-60 motion-safe:blur-xs opacity-0 data-visible:rotate-0 data-visible:scale-100 data-visible:blur-none data-visible:opacity-100"
          strokeWidth={2}
        />
        {/* System mode: computer */}
        <HugeiconsIcon
          icon={ComputerIcon}
          data-visible={active === "system" || undefined}
          className="motion-safe:transition-all! motion-safe:duration-200 motion-safe:rotate-90 motion-safe:scale-60 motion-safe:blur-xs opacity-0 data-visible:rotate-0 data-visible:scale-100 data-visible:blur-none data-visible:opacity-100"
          strokeWidth={2}
        />
      </span>
    </Button>
  );
}
