"use client";

import { Button } from "@/components/ui/cubby-ui/button";

/**
 * TEMPORARY — dev-only scaffolding for the compare chart's arrival.
 *
 * DELETE THIS FILE, its two props on `CompareTrendChart` (`forceLoading`,
 * `entrance`), and the state and render in `CompareTrendSection`
 * (`app/(main)/compare/compare-content.tsx`) once the entrance question is
 * settled. TODO.md owns that deletion.
 *
 * Exists because both things it controls are otherwise only observable in the
 * first second after a page load, which makes comparing them a reload-per-look.
 *
 * Replays the real phase machine rather than faking a frame of it: flipping it
 * on pins `phase` to loading, flipping it off runs `concealing` and then
 * `ready` exactly as arriving data does.
 */

export function CompareTrendDevControls({
  loading,
  onLoadingChange,
}: {
  loading: boolean;
  onLoadingChange: (loading: boolean) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2">
      <span className="text-xs font-medium text-muted-foreground">dev</span>
      {/* Names what it does rather than what state it is in: a button reading
          "Ready" that puts the chart INTO loading is a coin flip every time.
          State lives in the variant and `aria-pressed`. */}
      <Button
        size="xs"
        variant={loading ? "primary" : "outline"}
        aria-pressed={loading}
        onClick={() => onLoadingChange(!loading)}
      >
        Force loading
      </Button>
      <span className="text-xs text-muted-foreground">
        replays the placeholder, its conceal, and the reveal
      </span>
    </div>
  );
}
