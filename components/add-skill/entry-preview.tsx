"use client";

import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { GithubIcon, Link04Icon } from "@hugeicons/core-free-icons";
import { readSkillInput, SKILL_INPUT_EXAMPLES } from "@/lib/add-skill-reading";
import { busyButtonProps } from "@/hooks/use-add-skill-field-a11y";
import { Button } from "@/components/ui/cubby-ui/button";
import { Crossfade } from "@/components/ui/cubby-ui/crossfade";
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
  onUseExample,
}: {
  input: string;
  /**
   * A request is in flight, so the sample chips must not rewrite the field.
   * The field itself is `readOnly` for the length of a request, and a control
   * that fills that same field is an edit by another route.
   */
  pending: boolean;
  /** Fills the field. Goes through the flow's own setter, so a pending
   *  candidate is invalidated exactly as typing would invalidate it. */
  onUseExample: (value: string) => void;
}) {
  const reading = useMemo(() => readSkillInput(input), [input]);
  // Both views stay mounted (the panel hides the inactive one), so the
  // reference view renders under a parsed reading too and cannot narrow on
  // `reading.frame` inline.
  const message = reading.frame === "reference" ? reading.message : undefined;
  // The row keeps showing the LAST parsed reading while it fades out. The
  // reading itself flips to `reference` the keystroke the input stops
  // parsing, and rendering the row from it directly emptied the row on that
  // frame, so the exit animated a blank panel. Render-time derived state, per
  // React's own pattern, rather than a ref written during render.
  const [shown, setShown] = useState(
    reading.frame === "parsed" ? reading : null,
  );
  if (reading.frame === "parsed" && reading !== shown) setShown(reading);

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
        "min-h-[8.25rem] rounded-lg border bg-card p-3 sm:min-h-27",
        // Inside the page's inset frame the hairline goes and the surface
        // shadow lifts the panel, exactly as the frame's field does. On the
        // dialog's muted body there is no frame, so the hairline stays.
        "in-data-framed:border-0 in-data-framed:shadow-[var(--surface-shadow-3),var(--surface-rim-3)]",
      )}
    >
      {/* Keyed on the FRAME: the swap fires when the panel changes what kind
          of thing it shows, not on every keystroke within one. `Crossfade` is
          the house "placeholder resolves into a result" swap (the repo URL
          input's status line, the change feed), which is exactly this: the
          reference frame is the placeholder and the parsed row is the result.
          It skips its entrance on first paint, which matters because this
          markup is prerendered; a hand-rolled `@starting-style` on it faded
          the centrepiece in on arrival. Both sides stay mounted, and the
          inactive one is `hidden`, so the sample chips leave the tab order
          while the row is showing and nothing moves focus off the field. */}
      <Crossfade active={reading.frame === "parsed"}>
        {/* Placeholder first, result second: `Crossfade` slides its first
            child down on exit and its second child in from above, so the row
            rises over the reference frame as the input resolves. */}
        <>
          {/* Foreground weight for a message, never `destructive`: the
                readout guides while you type and the submit notice is what
                judges. `break-words` because messages quote the pasted
                string, and a pasted URL has no break opportunity in it. */}
          <p
            className={cn(
              "text-sm break-words",
              message ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {message ?? "The entry you are adding appears here as you paste."}
          </p>
          {/* Kept under a message rather than replaced by it: an input the
                parser cannot read is exactly when a working sample is worth
                one click. */}
          {/* The caption is its own line, not the first item in the chip
                row: as a flex sibling it pushed the third chip onto a second
                row at 390px, where all three fit on one. */}
          <p
            id="add-skill-samples"
            className="mt-3 mb-1.5 text-xs text-muted-foreground"
          >
            Try a sample
          </p>
          {/* Named group, so a chip announces as "skills.sh link, button, Try
              a sample" rather than as an unexplained button. */}
          <div
            role="group"
            aria-labelledby="add-skill-samples"
            className="flex flex-wrap items-center gap-1.5"
          >
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
        <>
          {shown && (
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
                    icon={shown.viaGitHub ? GithubIcon : Link04Icon}
                    strokeWidth={2}
                    className="size-4.5"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {shown.skillId}
                  </p>
                  {/* The file path rides the source line rather than taking a
                    third, so the row is two lines for every input form and
                    the panel's floor is one number. A GitHub deep link's path
                    truncates on a phone; the confirm card prints it in full. */}
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {shown.source}
                    {shown.path && (
                      <>
                        <span aria-hidden> · </span>
                        <span className="sr-only">, file </span>
                        {shown.path}
                      </>
                    )}
                  </p>
                </div>
              </div>
              <p className="mt-3 border-t border-border pt-2.5 text-xs text-muted-foreground">
                {shown.viaGitHub
                  ? "We check skills.sh first, then the repo for its SKILL.md."
                  : "We check skills.sh. There is no GitHub repo to fall back to."}
              </p>
            </>
          )}
        </>
      </Crossfade>
    </div>
  );
}
