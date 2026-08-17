/**
 * What the /add field's display window reports about the current input.
 *
 * Pure, and deliberately outside the component that renders it: this is the
 * only logic on that surface worth testing, and as a module-private function
 * inside a `"use client"` component it was unreachable from `tests/`.
 *
 * `parseSkillInput` already ran on the add surfaces, but only on submit, as a
 * reject-and-explain gate. Running it per keystroke is what turns the field
 * into an instrument: the identifiers it derives are exactly what the add is
 * about to look up. Nothing here is authoritative about the RESULT — the
 * server re-parses and prefers a SKILL.md's frontmatter name over a
 * folder-derived slug. This reports on the INPUT.
 */

import { parseSkillInput } from "@/lib/parse-skill-input";
import { addSkillErrorText } from "@/lib/add-skill-copy";
import { isGitHubSource } from "@/lib/skill-urls";

/**
 * One real catalog entry per accepted form, so clicking one and submitting
 * lands on the true "already in the catalog" answer instead of a 404.
 *
 * Every URL form carries its scheme deliberately, and
 * `tests/add-skill-reading.test.ts` asserts each value still parses to the
 * source and slug it claims — without the scheme the leading `github.com` is
 * the whole source, which is the shape the pre-redesign placeholder taught.
 * That test guards the FORM. Catalog membership can't be asserted offline, so
 * the honest scope of the promise above is "these were real entries when
 * written".
 */
export const SKILL_INPUT_EXAMPLES = [
  {
    label: "skills.sh link",
    value: "https://skills.sh/anthropics/skills/frontend-design",
    expect: { source: "anthropics/skills", skillId: "frontend-design" },
  },
  {
    label: "GitHub link",
    value:
      "https://github.com/anthropics/skills/tree/main/skills/frontend-design",
    expect: { source: "anthropics/skills", skillId: "frontend-design" },
  },
  {
    label: "Short form",
    value: "vercel-labs/agent-skills/web-design-guidelines",
    expect: {
      source: "vercel-labs/agent-skills",
      skillId: "web-design-guidelines",
    },
  },
] as const;

/**
 * Two frames, not three states.
 *
 * The panel shows either the resolved identifiers or the reference list, and
 * the reference frame optionally carries a message above it. Modelling
 * "examples" and "invalid" as separate arms meant every consumer folded them
 * back together for the entrance key and then un-folded them again for the
 * message.
 */
export type SkillInputReading =
  | { frame: "reference"; message?: string }
  | {
      frame: "parsed";
      source: string;
      skillId: string;
      path?: string;
      /** The source is `owner/repo`, so there is a repo to fall back to. */
      viaGitHub: boolean;
    };

/**
 * Is this input still being typed, rather than wrong?
 *
 * `parseSkillInput` throws for everything short of a complete identifier, so
 * without this the panel quotes the user's half-finished string back at them
 * on almost every keystroke: `https://` alone is a valid `URL`, so hand-typing
 * one walks through `Got "g"`, `Got "gi"`, `Got "git"`. Reporting a mistake
 * before the input could possibly be complete is the "told off for typing"
 * effect the readout exists to avoid.
 */
function looksUnfinished(trimmed: string): boolean {
  // Nothing structural yet, or mid-separator: a trailing slash always means
  // the next segment is still coming.
  if (!trimmed.includes("/") || trimmed.endsWith("/")) return true;
  // A scheme with no host yet, or a host still being typed with no path.
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/]*$/i.test(trimmed)) return true;
  return false;
}

export function readSkillInput(input: string): SkillInputReading {
  const trimmed = input.trim();
  if (!trimmed || looksUnfinished(trimmed)) return { frame: "reference" };

  let parsed: ReturnType<typeof parseSkillInput>;
  try {
    parsed = parseSkillInput(trimmed);
  } catch (err) {
    // Through the shared copy layer, so the panel and the submit notice say
    // the same sentence for the same throw. Reading `err.message` directly
    // printed the parser's internal wording next to the rewritten one.
    return { frame: "reference", message: addSkillErrorText(err) };
  }

  return {
    frame: "parsed",
    source: parsed.source,
    skillId: parsed.skillId,
    path: parsed.path,
    // The canonical check, not a local re-derivation of the dot rule. The
    // inline version dropped its `parts.length === 2` half, which is how the
    // fourth copy of this rule would have drifted from the other three.
    viaGitHub: isGitHubSource(parsed.source),
  };
}
