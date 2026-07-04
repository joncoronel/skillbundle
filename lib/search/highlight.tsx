import * as React from "react";

// Minimal HTML-entity decode for the text between/around Typesense's <mark>
// tags. Typesense escapes these five in field values; we render the parts as
// React text (never innerHTML), so we decode them back to their characters.
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

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
  // Typesense injects only balanced, non-nested <mark>/</mark>. Splitting on
  // both tags yields alternating segments: even index = unmarked, odd = marked.
  const segments = value.split(/<\/?mark>/);
  return segments.map((segment, i) => {
    const text = decodeEntities(segment);
    if (!text) return null;
    return i % 2 === 1 ? (
      <mark key={i} className="text-primary bg-transparent font-bold">
        {text}
      </mark>
    ) : (
      <React.Fragment key={i}>{text}</React.Fragment>
    );
  });
}
