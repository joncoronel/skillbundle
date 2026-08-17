"use client";

import { useEffect, useMemo, useState } from "react";
import { readSkillInput, SKILL_INPUT_EXAMPLES } from "@/lib/add-skill-reading";
import { busyRowProps } from "@/hooks/use-add-skill-field-a11y";
import { cn } from "@/lib/utils";

/**
 * The field's display window: what the app read from what you pasted, before
 * you commit to it. All of the reading lives in `lib/add-skill-reading.ts`;
 * this file only renders it.
 */
export function InputReadout({
  input,
  pending,
  onUseExample,
}: {
  input: string;
  /**
   * A request is in flight, so the rows must not rewrite the field. The field
   * itself is `readOnly` for the length of a request, and a control that fills
   * that same field is an edit by another route.
   */
  pending: boolean;
  /** Fills the field. Goes through the flow's own setter, so a pending
   *  candidate is invalidated exactly as typing would invalidate it. */
  onUseExample: (value: string) => void;
}) {
  const reading = useMemo(() => readSkillInput(input), [input]);

  // Skip @starting-style on the first paint, following crossfade.tsx.
  //
  // Every other `starting:` in this app is on content that mounts after
  // hydration; this panel is in the prerendered HTML of a fully static route,
  // and `@starting-style` DOES apply to the initial style resolution there.
  // Measured in a same-origin iframe load: the panel came up at opacity 0.59
  // with a 1.65px offset and settled over the next ~40ms. So the one route
  // whose whole value is that its shell is already painted was fading its
  // centrepiece in on arrival.
  //
  // Adding the classes after mount cannot itself animate: @starting-style
  // supplies a before-change style only when an element is first styled, and
  // this one already is. The keyed remount on a frame change is a new element,
  // so that entrance still fires.
  // Flipped inside a frame callback rather than synchronously in the effect:
  // `crossfade.tsx` writes the same guard as a bare `setMounted(true)`, but
  // `components/ui/cubby-ui/` is outside the lint gate and this file is not, so
  // the same line here is a cascading-render error. Deferring is also the more
  // literal statement of the intent, which is "after the first paint".
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    // A FLOOR, not a fixed height, and sized per breakpoint to the tallest
    // frame there (measured, not computed: the reference frame is tallest, and
    // its lead line and the rows both wrap differently at narrow widths). It
    // holds only while the four strings below stay their current length, which
    // is why `break-words` and the parser's 60-character quote cap matter —
    // together they bound how far copy can push it.
    //
    // Recessed rather than raised: this is the panel the field reports into,
    // and bg-muted is the house inset tone (Card's `inset` variant uses it),
    // so it reads the same way inside the dialog.
    <div className="min-h-44 rounded-lg border border-border bg-muted p-3 sm:min-h-38">
      {/* Keyed on the FRAME: the entrance fires when the panel changes what
          kind of thing it shows, not on every keystroke within one, and not
          when a bad character merely adds a message above a reference list
          that was already sitting there. */}
      <div
        key={reading.frame}
        className={cn(
          "transition-[opacity,translate] duration-200 ease-out-cubic motion-reduce:transition-none",
          mounted && "starting:translate-y-1 starting:opacity-0",
        )}
      >
        {reading.frame === "parsed" ? (
          <>
            {/* Same term/value vocabulary as the confirm card, so the row you
                read here is the row you confirm there. */}
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">Source</dt>
              <dd className="truncate font-mono">{reading.source}</dd>
              <dt className="text-muted-foreground">Slug</dt>
              <dd className="truncate font-mono">{reading.skillId}</dd>
              {reading.path && (
                <>
                  <dt className="text-muted-foreground">File</dt>
                  <dd className="truncate font-mono">{reading.path}</dd>
                </>
              )}
            </dl>
            <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
              {reading.viaGitHub
                ? "We check skills.sh first, then look for the SKILL.md in the repo."
                : "We check skills.sh. There is no GitHub repo to fall back to."}
            </p>
          </>
        ) : (
          <>
            {/* Foreground weight, never `destructive`. The readout guides while
                you type and the submit notice is what judges. `break-words`
                because these messages quote the pasted string, and a pasted
                URL has no break opportunity in it — without this the message
                runs past the panel and scrolls the page sideways. */}
            <p
              className={
                reading.message
                  ? "text-xs break-words text-foreground"
                  : "text-xs break-words text-muted-foreground"
              }
            >
              {reading.message ??
                "Any of these forms works. Click one to fill the field."}
            </p>
            {/* Kept up under a message rather than replaced by it. An input the
                parser can't read is exactly when the accepted forms are worth
                seeing, and a lone sentence in a fixed-height panel is the void
                this whole surface exists to remove. */}
            <ul className="mt-2.5 space-y-1.5">
              {SKILL_INPUT_EXAMPLES.map((example) => (
                <li key={example.label}>
                  {/* A raw button, not the cubby `Button`: its content wrappers
                      set no `min-width: 0`, so the truncating value below
                      overflowed the button and scrolled the page sideways at
                      375px instead of ellipsising. The a11y half of that
                      trade-off is owned centrally by `busyRowProps` rather
                      than re-derived here; its handler guard is mandatory,
                      because `aria-disabled` alone does not stop a click.
                      `h-8 sm:h-7` gives the wider touch target on the
                      viewport where mis-taps overwrite the field. */}
                  <button
                    type="button"
                    {...busyRowProps({ unavailable: pending })}
                    onClick={() => {
                      if (pending) return;
                      onUseExample(example.value);
                    }}
                    className={cn(
                      "group flex h-8 w-full items-center gap-3 rounded-md px-2 text-left transition-[opacity,background-color,color] duration-100 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50 motion-reduce:transition-none sm:h-7",
                      pending
                        ? "cursor-not-allowed opacity-60"
                        : "hover:bg-surface-hover",
                    )}
                  >
                    <span className="w-24 shrink-0 text-xs text-muted-foreground">
                      {example.label}
                    </span>
                    {/* `min-w-0` is what lets `truncate` win: a flex item
                        defaults to `min-width: auto`, so an unbreakable mono
                        string sets the floor and pushes the row wider than its
                        container. */}
                    <span className="min-w-0 truncate font-mono text-xs text-muted-foreground transition-colors duration-100 ease-out group-hover:text-foreground motion-reduce:transition-none">
                      {example.value}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
