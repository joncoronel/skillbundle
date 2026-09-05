"use client";

import { useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { GithubIcon, Link04Icon } from "@hugeicons/core-free-icons";
import { readSkillInput, SKILL_INPUT_EXAMPLES } from "@/lib/add-skill-reading";
import { busyButtonProps } from "@/hooks/use-add-skill-field-a11y";
import { Button } from "@/components/ui/cubby-ui/button";
import { cn } from "@/lib/utils";

/**
 * The entry the field is about to create, drawn as it will sit in the catalog.
 *
 * This is the instrument's display: the field above it is what you paste into,
 * this is what the app read. It replaced a recessed gray panel that listed the
 * three accepted forms as URL rows, a reference card, when what the page needs
 * is the RESULT. All of the reading lives in `lib/add-skill-reading.ts`; this
 * file only renders it, in the same row vocabulary as a catalog row (name over
 * mono source) so the thing you preview here is recognisably the thing you
 * land on after the add. It carries no state light on purpose: the row would
 * only ever show "not checked" and the button already reports progress, so a
 * light here was a second, weaker copy of the button's own label.
 *
 * It never announces and never turns red. The readout guides while you type;
 * the flow's `#add-skill-notice` judges, and it is the only live region here.
 */
export function EntryPreview({
  input,
  pending,
  framed,
  onUseExample,
}: {
  input: string;
  /**
   * A request is in flight, so the sample chips must not rewrite the field.
   * The field itself is `readOnly` for the length of a request, and a control
   * that fills that same field is an edit by another route.
   */
  pending: boolean;
  /**
   * Mounted inside the page's inset frame (borderless, lifted by the surface
   * shadow like the frame's field) rather than on a dialog's muted body
   * (hairline border, no shadow). Same panel, two substrates.
   */
  framed: boolean;
  /** Fills the field. Goes through the flow's own setter, so a pending
   *  candidate is invalidated exactly as typing would invalidate it. */
  onUseExample: (value: string) => void;
}) {
  const reading = useMemo(() => readSkillInput(input), [input]);

  // Skip @starting-style on the first paint, following crossfade.tsx.
  //
  // This panel is in the prerendered HTML of a fully static route, and
  // `@starting-style` DOES apply to the initial style resolution there.
  // Measured on this panel's predecessor: it came up at opacity 0.59 with a
  // 1.65px offset and settled over ~40ms, so the one route whose whole value
  // is that its shell is already painted was fading its centrepiece in on
  // arrival.
  //
  // Adding the classes after mount cannot itself animate: @starting-style
  // supplies a before-change style only when an element is first styled, and
  // this one already is. The keyed remount on a frame change is a new element,
  // so that entrance still fires. Flipped inside a frame callback rather than
  // synchronously in the effect, because a bare `setMounted(true)` in an
  // effect is a cascading-render lint error in this file.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className={cn(
        // A FLOOR, not a fixed height, measured per breakpoint against the
        // tallest frame there, which is the reference frame at both: 130px at
        // 390px where its lead sentence wraps, 106px from `sm` up. The parsed
        // frame is two lines plus the footer (99px) at every width because the
        // file path shares the source line. It holds only while the strings
        // below stay short, which is why messages `break-words` and the
        // parser caps the input it echoes at 60 characters.
        "min-h-[8.25rem] rounded-lg bg-card p-3 sm:min-h-27",
        framed
          ? "shadow-[var(--surface-shadow-3),var(--surface-rim-3)]"
          : "border",
      )}
    >
      {/* Keyed on the FRAME: the entrance fires when the panel changes what
          kind of thing it shows, not on every keystroke within one. */}
      <div
        key={reading.frame}
        className={cn(
          "transition-[opacity,translate] duration-200 ease-out-cubic motion-reduce:transition-none",
          mounted && "starting:translate-y-1 starting:opacity-0",
        )}
      >
        {reading.frame === "parsed" ? (
          <>
            <div className="flex items-center gap-3">
              {/* The source's glyph in the slot a catalog row keeps for its
                  checkbox: GitHub for an `owner/repo`, a link for a well-known
                  host. It is the only place the row says which kind of source
                  it read, and `viaGitHub` also drives the footer sentence, so
                  the glyph and the sentence can never disagree. */}
              <span
                aria-hidden
                className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-foreground"
              >
                <HugeiconsIcon
                  icon={reading.viaGitHub ? GithubIcon : Link04Icon}
                  strokeWidth={2}
                  className="size-4.5"
                />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">
                  {reading.skillId}
                </p>
                {/* The file path rides the source line rather than taking a
                    third, so the row is two lines for every input form and
                    the panel's floor is one number. A GitHub deep link's path
                    truncates on a phone; the confirm card prints it in full. */}
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {reading.source}
                  {reading.path && (
                    <>
                      <span aria-hidden> · </span>
                      <span className="sr-only">, file </span>
                      {reading.path}
                    </>
                  )}
                </p>
              </div>
            </div>
            <p className="mt-3 border-t border-border pt-2.5 text-xs text-muted-foreground">
              {reading.viaGitHub
                ? "We check skills.sh first, then the repo for its SKILL.md."
                : "We check skills.sh. There is no GitHub repo to fall back to."}
            </p>
          </>
        ) : (
          <>
            {/* Foreground weight for a message, never `destructive`: the
                readout guides while you type and the submit notice is what
                judges. `break-words` because messages quote the pasted
                string, and a pasted URL has no break opportunity in it. */}
            <p
              className={cn(
                "text-sm break-words",
                reading.message ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {reading.message ??
                "The entry you are adding appears here as you paste."}
            </p>
            {/* Kept under a message rather than replaced by it: an input the
                parser cannot read is exactly when a working sample is worth
                one click. */}
            {/* The caption is its own line, not the first item in the chip
                row: as a flex sibling it pushed the third chip onto a second
                row at 390px, where all three fit on one. */}
            <p className="mt-3 mb-1.5 text-xs text-muted-foreground">
              Try a sample
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {SKILL_INPUT_EXAMPLES.map((example) => (
                <Button
                  key={example.label}
                  type="button"
                  variant="secondary"
                  size="xs"
                  disabled={pending}
                  {...busyButtonProps({ inFlight: false })}
                  onClick={() => onUseExample(example.value)}
                >
                  {example.label}
                </Button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
