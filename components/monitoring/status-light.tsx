import { cn } from "@/lib/utils";
import type { GroupKey } from "@/lib/monitoring/conditions";

/**
 * The instrument light, and the one implementation of it.
 *
 * A 6px dot in a soft ring of its own hue — small enough that green on a
 * healthy visit reads as "powered on" rather than as congratulation, which is
 * what would make it noise after the third time.
 *
 * Colour is never the only carrier: every caller states the condition in words
 * beside it.
 *
 * There were three of these (the dashboard's `TONE_LIGHT`, the register's
 * `GROUP_META` dot/halo, and a third inline pair in its tally) across five tone
 * vocabularies for three colours. DESIGN.md calls this readout system-level;
 * a third surface reuses it rather than reinventing it.
 */
export type Tone = "clear" | "hold" | "content" | "alert";

/** Group → tone, so a surface holding rows never has to re-derive the mapping. */
export const TONE_OF_GROUP: Record<GroupKey, Tone> = {
  attention: "alert",
  changed: "content",
  steady: "clear",
};

const TONE_LIGHT: Record<Tone, { dot: string; halo: string }> = {
  clear: { dot: "bg-success-foreground", halo: "bg-success/20" },
  // Neutral, not red. "Hold" means the product is declining to assert these
  // yet; lighting it with the severity of what it is holding back would assert
  // exactly the thing it is withholding.
  hold: { dot: "bg-muted-foreground", halo: "bg-muted-foreground/15" },
  content: { dot: "bg-warning-foreground", halo: "bg-warning/20" },
  alert: { dot: "bg-danger-foreground", halo: "bg-danger/20" },
};

export function StatusLight({
  tone,
  className,
}: {
  tone: Tone;
  className?: string;
}) {
  const { dot, halo } = TONE_LIGHT[tone];
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-full",
        halo,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", dot)} />
    </span>
  );
}
