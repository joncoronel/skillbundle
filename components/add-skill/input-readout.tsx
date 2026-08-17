"use client";

import { useMemo } from "react";
import { parseSkillInput } from "@/lib/parse-skill-input";
import { cn } from "@/lib/utils";

/**
 * The field's display window: it reports what the app read from what you
 * pasted, before you commit to it.
 *
 * `parseSkillInput` is pure and already ran on this surface — but only on
 * submit, as a reject-and-explain gate. Running it per keystroke turns the same
 * function into the thing that makes this page an instrument instead of a text
 * box: the identifiers it derives (source, slug, and the SKILL.md path a link
 * already named) are exactly what the add is about to look up, and seeing them
 * resolve is how you know the link you grabbed points where you think it does.
 *
 * Nothing here is authoritative about the RESULT — the server re-parses, and
 * prefers a SKILL.md's frontmatter name over a folder-derived slug, which the
 * confirm card explains where it happens. This reports on the INPUT.
 */

/**
 * One real catalog entry per accepted form, read off the live catalog rather
 * than invented, so clicking one and submitting lands on the true
 * "already in the catalog" answer instead of a 404.
 *
 * Every URL form carries its scheme deliberately. Without it the first segment
 * is a dot-bearing string, which is the parser's signal for a well-known
 * source, so `github.com/owner/repo/...` resolves to the source "github.com"
 * with the whole rest as a slug. The old placeholder on this page advertised
 * exactly that shape.
 */
const EXAMPLES = [
  {
    label: "skills.sh link",
    value: "https://skills.sh/anthropics/skills/frontend-design",
  },
  {
    label: "GitHub link",
    value:
      "https://github.com/anthropics/skills/tree/main/skills/frontend-design",
  },
  {
    label: "Short form",
    value: "vercel-labs/agent-skills/web-design-guidelines",
  },
] as const;

/** The bare hosts a scheme-less URL collapses to. See EXAMPLES above. */
const BARE_HOSTS = new Set([
  "github.com",
  "skills.sh",
  "raw.githubusercontent.com",
]);

type Reading =
  | { mode: "examples" }
  | {
      mode: "parsed";
      source: string;
      skillId: string;
      path?: string;
      /** The source is `owner/repo`, so there is a repo to fall back to. */
      viaGitHub: boolean;
    }
  | { mode: "invalid"; message: string };

function read(input: string): Reading {
  const trimmed = input.trim();
  if (!trimmed) return { mode: "examples" };

  let parsed: ReturnType<typeof parseSkillInput>;
  try {
    parsed = parseSkillInput(trimmed);
  } catch (err) {
    // Half-typed input is not a mistake to report. Until there is a separator
    // there is no structure to read, so the reference stays up rather than the
    // parser's "Invalid skill input" firing on the first character.
    if (!trimmed.includes("/")) return { mode: "examples" };
    return {
      mode: "invalid",
      message:
        err instanceof Error
          ? err.message
          : "That is not a skill link we recognise.",
    };
  }

  // A URL pasted without its scheme parses, and parses WRONG: the host becomes
  // the source. It is the one failure that looks like a success, so it is
  // named here rather than left to read as a resolved skill under the source
  // "github.com".
  if (BARE_HOSTS.has(parsed.source)) {
    return {
      mode: "invalid",
      message: `Add "https://" to the front. Without it, "${parsed.source}" reads as the source instead of the site.`,
    };
  }

  return {
    mode: "parsed",
    source: parsed.source,
    skillId: parsed.skillId,
    path: parsed.path,
    // The same split the parser uses: a dot in the first segment means a
    // well-known source, anything else is owner/repo on GitHub. Only the
    // latter has a repo the add can fall back into.
    viaGitHub: !parsed.source.split("/")[0].includes("."),
  };
}

export function InputReadout({
  input,
  pending,
  onUseExample,
}: {
  input: string;
  /**
   * A request is in flight, so the rows must not rewrite the field.
   *
   * The field itself is `readOnly` for the length of a request (see the header
   * of `hooks/use-add-skill-field-a11y.ts` for why `readOnly` and not
   * `disabled`), and a control that fills that same field is an edit by another
   * route. `aria-disabled` with a guarded handler rather than the native
   * attribute, for the reason that module gives: a natively disabled element
   * cannot hold focus, and one submit can be three round trips.
   */
  pending: boolean;
  /** Fills the field. Goes through the flow's own setter, so a pending
   *  candidate is invalidated exactly as typing would invalidate it. */
  onUseExample: (value: string) => void;
}) {
  const reading = useMemo(() => read(input), [input]);

  return (
    // Height is held across the states so resolving a paste never moves the
    // outcomes below it. Recessed rather than raised: this is the panel the
    // field reports into, and bg-muted is the house inset tone (Card's `inset`
    // variant uses it), so it reads the same way inside the dialog.
    <div className="min-h-36 rounded-lg border border-border bg-muted p-3">
      {/* Keyed on the FRAME, not the mode: the entrance fires when the panel
          changes what kind of thing it is showing, and not on every keystroke
          within one, nor when a bad character merely adds a message above a
          reference list that was already sitting there. One authored moment
          rather than a twitch per character. */}
      <div
        key={reading.mode === "parsed" ? "parsed" : "reference"}
        className="transition-[opacity,translate] duration-200 ease-out-cubic motion-reduce:transition-none starting:translate-y-1 starting:opacity-0"
      >
        {reading.mode === "parsed" ? (
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
                ? "We look for this on skills.sh first. If it isn't listed there, we find the SKILL.md in the repo and ask you to confirm it."
                : "We look for this on skills.sh. There is no GitHub repo to fall back to."}
            </p>
          </>
        ) : (
          <>
            {/* Foreground weight, never `destructive`. The readout guides while
                you type and the submit notice is what judges: turning this red
                on a half-finished paste reads as being told off for typing. */}
            <p
              className={
                reading.mode === "invalid"
                  ? "text-xs text-foreground"
                  : "text-xs text-muted-foreground"
              }
            >
              {reading.mode === "invalid"
                ? reading.message
                : "Any of these forms works. Click one to fill the field."}
            </p>
            {/* Kept up under a message rather than replaced by it. An input the
                parser can't read is exactly when the accepted forms are worth
                seeing, and a lone sentence in a fixed-height panel is the void
                this whole surface exists to remove. */}
            <ul className="mt-2.5 space-y-1">
              {EXAMPLES.map((example) => (
                <li key={example.label}>
                  {/* `bg-surface-hover` rather than a surface level: the row
                      carries no fill of its own, so the translucent tint
                      composites over the panel and reads as a darkening in
                      light and a lightening in dark. A level would have to
                      pick a side, and `surface-2` sits the wrong side of
                      `muted` in dark, where the hover all but vanished. */}
                  <button
                    type="button"
                    aria-disabled={pending || undefined}
                    onClick={() => {
                      if (pending) return;
                      onUseExample(example.value);
                    }}
                    className={cn(
                      "group flex h-7 w-full items-center gap-3 rounded-md px-2 text-left transition-[opacity,background-color,color] duration-100 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50 motion-reduce:transition-none",
                      // Dimmed rather than silently inert: a row that looks
                      // live and does nothing is worse than one that says it
                      // is unavailable, which is the same call the dialog's
                      // close button makes while a write is in flight.
                      pending
                        ? "cursor-not-allowed opacity-60"
                        : "hover:bg-surface-hover",
                    )}
                  >
                    <span className="w-24 shrink-0 text-xs text-muted-foreground">
                      {example.label}
                    </span>
                    {/* Muted at rest so the reference does not out-shout the
                        field above it, which is the object on this page. */}
                    <span className="truncate font-mono text-xs text-muted-foreground transition-colors duration-100 ease-out group-hover:text-foreground motion-reduce:transition-none">
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
