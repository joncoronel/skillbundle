import * as React from "react";
import { NAME_TOKEN_SEPARATORS } from "@/lib/search/token-separators";

// Minimal HTML-entity decode for the text between/around Typesense's <mark>
// tags. Typesense escapes these five in field values; we render the parts as
// React text (never innerHTML), so we decode them back to their characters.
// One pass over the string (this runs per result row per keystroke).
const ENTITY_RE = /&(?:amp|lt|gt|#39|quot);/g;
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&#39;": "'",
  "&quot;": '"',
};
function decodeEntities(s: string): string {
  return s.replace(ENTITY_RE, (entity) => ENTITIES[entity]);
}

// Hoisted — see renderHighlight below. (`split` never uses lastIndex, and
// `replace` with /g resets it, so sharing these across calls is safe.)
// The separator class is built from the collection schema's own
// token_separators so the bridge can't drift from what Typesense splits on.
const BRIDGE_SEPARATORS_RE = new RegExp(
  `</mark>([${NAME_TOKEN_SEPARATORS.map((s) => `\\${s}`).join("")}]+)<mark>`,
  "g",
);
const MARK_TAG_RE = /<\/?mark>/;

/**
 * Render Typesense's highlight `value` — the field text with matched tokens
 * wrapped in `<mark>…</mark>` — as React nodes. We split on the mark tags and
 * render each segment as a plain text child, so any other markup in the value
 * is shown literally (React escapes it); nothing is passed to innerHTML.
 *
 * Using the engine's highlight (rather than re-marking the query client-side)
 * means matches are fuzzy-aware: a typo'd query like "postgress" still marks the
 * corrected token ("neon-<mark>postgres</mark>"), and prefixes mark exactly the
 * matched span ("<mark>vercel</mark>-<mark>compo</mark>sition-patterns").
 */
export function renderHighlight(value: string): React.ReactNode {
  // Bridge marks separated by only separator chars: Typesense marks tokens but
  // not the `-`/`_`/`.`/`/` between them, so "vercel-react-best" comes back as
  // three marks with bare hyphens between. Absorb those separators into a single
  // run so a contiguous match highlights as one span, not blue-white-blue.
  const bridged = value.replace(BRIDGE_SEPARATORS_RE, "$1");

  // Typesense injects only balanced, non-nested <mark>/</mark>. Splitting on
  // both tags yields alternating segments: even index = unmarked, odd = marked.
  const segments = bridged.split(MARK_TAG_RE);
  return segments.map((segment, i) => {
    const text = decodeEntities(segment);
    if (!text) return null;
    return i % 2 === 1 ? (
      <mark key={i} className="bg-transparent font-bold text-primary">
        {text}
      </mark>
    ) : (
      <React.Fragment key={i}>{text}</React.Fragment>
    );
  });
}
