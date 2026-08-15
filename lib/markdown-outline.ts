/**
 * Heading outline for a SKILL.md, and the slug rule that both sides of the
 * anchor share.
 *
 * The skill page renders the section nav on the server, so the nav has to know
 * a heading's DOM id BEFORE that heading exists — which means the id can't be
 * handed out by a stateful slugger walking the rendered tree. Instead
 * `docHeadingId` is a PURE function of the heading's text, called twice from
 * two places that never meet:
 *
 *   - here, over the raw markdown, to build the nav
 *   - in components/markdown-content.tsx, over the rendered heading's text
 *
 * Because it's pure, the two agree without coordination and without a render
 * cursor that a React re-render could desynchronise. The cost is duplicate
 * headings: two `## Usage` sections produce one id, so the nav lists it once
 * and the link lands on the first. That is the right failure — a numbered
 * `usage-2` would need shared mutable state, and jumping to the first "Usage"
 * is what a reader expects anyway.
 *
 * Ids carry a `doc-` prefix so a SKILL.md heading called "History" can never
 * collide with the page's own `#history` section.
 */

// The renderer's own entity decoders, not a reimplementation of them. Both are
// micromark internals that react-markdown already pulls in; promoting them to
// direct dependencies costs nothing installed and makes "the extractor agrees
// with the renderer" structural instead of a table someone has to maintain.
// The hand-written six-entry map they replaced also missed everything a real
// heading carries (`&mdash;`, `&hellip;`, `&rarr;`, `&copy;`) and lowercased
// its lookup, so `&Auml;` decoded to the wrong letter.
import { decodeNamedCharacterReference } from "decode-named-character-reference";
import { decodeNumericCharacterReference } from "micromark-util-decode-numeric-character-reference";

export type OutlineItem = {
  /** DOM id of the heading this points at. */
  id: string;
  title: string;
  /** Source heading level: 1 for `#`, 2 for `##`, 3 for `###`. */
  depth: number;
};

const DOC_HEADING_PREFIX = "doc-";

/** Deepest source level that earns a nav entry. `####` and below are noise. */
const MAX_DEPTH = 3;

/** Hard ceiling on nav entries. A long SKILL.md can carry 100+ headings. */
const MAX_ITEMS = 48;

/**
 * Heading text → slug. Kept deliberately simple, and deliberately NOT
 * underscore-stripping: CommonMark leaves intraword `_` alone (`snake_case`
 * renders literally), so both callers must see the same character and let the
 * separator rule below fold it to `-`.
 */
export function slugifyHeading(text: string): string {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The id a rendered SKILL.md heading gets, or undefined if it slugs to nothing. */
export function docHeadingId(text: string): string | undefined {
  const slug = slugifyHeading(text);
  return slug ? `${DOC_HEADING_PREFIX}${slug}` : undefined;
}

/**
 * Strip the inline markdown a heading can carry, so the extracted title matches
 * the text the renderer will produce.
 *
 * `_` is left alone on purpose (see slugifyHeading). `*` and `` ` `` and `~`
 * are removed unconditionally — an asterisk or backtick that survives into a
 * rendered heading is vanishingly rare next to emphasis and inline code, which
 * are common.
 *
 * ── Order is load-bearing ─────────────────────────────────────────────────
 *
 * Three of these steps used to disagree with the renderer, and every
 * disagreement broke a nav entry silently: the rail showed a mangled label,
 * the anchor pointed at an id no element had, and the scroll spy skipped that
 * heading forever. `tests/markdown-outline.test.ts` now pins one case per
 * shape.
 *
 * 1. Inline code is protected BEFORE the HTML strip. ``## Using `<Suspense>`
 *    boundaries`` renders with the tag as literal text; stripping
 *    `<[^>]+>` first deleted it, so the extractor produced "Using boundaries"
 *    against the renderer's "Using <Suspense> boundaries". A heading naming a
 *    tag or a generic in backticks is ordinary in agent-skill docs.
 * 2. An image contributes NOTHING to the rendered text — `childrenToText`
 *    walks children and an `<img>` has none — so its alt text is dropped here
 *    rather than kept. Links keep their text, because an `<a>` does have
 *    children.
 * 3. Entities are decoded, because the renderer receives them already decoded.
 */
function stripInlineMarkdown(raw: string): string {
  // Inline code spans, unwrapped and held aside so the HTML strip below cannot
  // reach into them. Restored after, by which point no `<`/`>` is a tag.
  //
  // NUL-delimited rather than a bare index, which would collide with a heading
  // like "Step 1 of 3" and splice a code span into it. Any NUL already in the
  // source is folded to U+FFFD first, both because that is what micromark does
  // with one (so the two sides stay in agreement) and because it is what makes
  // the delimiter unforgeable — `&#0;` in a heading used to reach this point.
  const codeSpans: string[] = [];
  const withoutCode = raw
    .replace(/\u0000/g, "\uFFFD")
    .replace(/`+([^`]*)`+/g, (_match, inner: string) => {
      codeSpans.push(inner);
      return `\u0000${codeSpans.length - 1}\u0000`;
    });

  return withoutCode
    .replace(/\{#[\w-]+\}\s*$/, "") // explicit-id syntax some generators emit
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images render as no text at all
    .replace(/!\[[^\]]*\]\[[^\]]*\]/g, "") // reference images, same
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // inline links keep their text
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1") // reference links, same
    .replace(/<[^>]+>/g, "") // stray inline HTML
    .replace(/[*~]/g, "")
    .replace(/&(#\d+|#[xX][0-9a-fA-F]+|\w+);/g, (match, body: string) => {
      if (!body.startsWith("#")) {
        return decodeNamedCharacterReference(body) || match;
      }
      const hex = body[1] === "x" || body[1] === "X";
      return decodeNumericCharacterReference(
        body.slice(hex ? 2 : 1),
        hex ? 16 : 10,
      );
    })
    .replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codeSpans[Number(i)])
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ATX headings (`#`…`###`) in document order.
 *
 * Fenced code is skipped, because a shell block full of `# comment` lines would
 * otherwise fill the nav with garbage — that is the single most common shape in
 * a SKILL.md. Setext headings (`Title` over `=====`) are not extracted; they
 * still render with an id, they just don't appear in the nav, which is a
 * graceful degradation rather than a broken link.
 */
export function extractOutline(markdown: string): OutlineItem[] {
  const lines = markdown.split(/\r?\n/);
  const items: OutlineItem[] = [];
  const seen = new Set<string>();

  let inFence = false;
  let fenceChar = "";
  let fenceLength = 0;
  let start = 0;

  // Skip YAML frontmatter. Not usually present by the time content reaches us,
  // but a `description:` block could hold a `#` line and it costs four lines to
  // rule out.
  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
    if (close > 0) start = close + 1;
  }

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];

    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const marker = fence[1];
      if (!inFence) {
        inFence = true;
        fenceChar = marker[0];
        fenceLength = marker.length;
      } else if (marker[0] === fenceChar && marker.length >= fenceLength) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;

    const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!heading) continue;

    const depth = heading[1].length;
    if (depth > MAX_DEPTH) continue;

    const title = stripInlineMarkdown(heading[2]);
    if (!title) continue;

    const id = docHeadingId(title);
    if (!id || seen.has(id)) continue;

    seen.add(id);
    items.push({ id, title, depth });
    if (items.length >= MAX_ITEMS) break;
  }

  return items;
}

/**
 * Rebase an outline so its shallowest heading is level 1, then drop anything
 * deeper than `maxLevels`.
 *
 * SKILL.md files split roughly in half between "one `#` title then `##`
 * sections" and "`##` sections all the way down". Without rebasing, the first
 * shape nests every real section one level deeper than the second for no
 * reason the reader can see.
 */
export function normalizeOutline(
  items: OutlineItem[],
  maxLevels = 2,
): (OutlineItem & { level: number })[] {
  if (items.length === 0) return [];
  const shallowest = Math.min(...items.map((item) => item.depth));
  return items
    .map((item) => ({ ...item, level: item.depth - shallowest + 1 }))
    .filter((item) => item.level <= maxLevels);
}
