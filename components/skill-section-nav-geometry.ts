/**
 * The shape of the skill page's section rail: where its lines sit, and the two
 * functions that draw them.
 *
 * Split out of skill-section-nav.tsx because three things need the same
 * numbers and none of them needs the others' internals: the nav (row padding),
 * the branch body (SVG paths), and the loading skeleton (row padding again).
 * They are pure values and pure functions, so nothing here imports React.
 *
 * ── The coordinate system ─────────────────────────────────────────────────
 *
 * All px, all measured from the nav's own left edge. One spine at x=0 that
 * every row hangs off, and, for the one branch that is open, a second trunk
 * dropping under the parent and elbowing out to each child.
 *
 * Flush LEFT, not right, and that is the whole reason the rail sits on the
 * trailing side of the page (see skill-detail-page.tsx). The spine is the edge
 * that faces the document; every ragged thing, the indents and the branch
 * ends, runs away from the text into the outer margin. Mirror the tree only if
 * the rail ever moves back to the leading side.
 *
 * ── The three numbers that decide whether this looks like a tree ───────────
 *
 * An elbow is an arc plus a STRAIGHT ARM, and the arm is what makes it read as
 * a branch. The first pass gave the arc 9 of an 11.5px horizontal run and left
 * 2.5px of arm, so the arc was effectively the whole shape and each branch
 * came out a little hook that stopped as soon as it had turned. An arm roughly
 * as long as the gap to the label reads as a corner and a reach.
 *
 * The child indent is the other half of it. 20px was enough to be legible and
 * not enough to be a level: the children sat almost under their parent with a
 * drawn tree crammed into the gap. At 34 the tree has room to be a shape, and
 * the nesting is visible before you have read a word.
 *
 * Both came from measuring the reference these were modelled on, which works
 * out to trunk +14 / arm 8 / indent +40 from its head's text. Ours are a shade
 * tighter because this rail is a 272px sidebar carrying real heading text, not
 * a demo with one-word labels, and the label still needs ~208px to wrap twice
 * rather than three times.
 *
 * ── What is NOT here ──────────────────────────────────────────────────────
 *
 * Row heights and line heights. They used to be constants beside these, and
 * that was a bug: `text-sm` is rem and scales with the reader's browser font
 * size, so a px line box stopped matching its own glyphs the moment anyone
 * enlarged the text. The rows now carry ordinary `py-1.5` / `leading-snug`
 * classes and the branch body READS the resulting geometry off the DOM. The
 * horizontal numbers below are safe as px because nothing about them scales
 * with type size.
 */

const ROW_X = 18; // A page section's label (level 0)
const SUB_X = 30; // A file heading's label (level 1)
const ELBOW_R = 10;
const ELBOW_END = 56; // Arc ends at 48, so 8px of straight arm
const CHILD_X = 64; // A nested heading's label (level 2), 8px past the arm

/**
 * The branch trunk, dropping under the parent's label.
 *
 * A whole number, and that follows from the stroke being 2px: a stroke is
 * centred on its coordinate, so an even width wants an integer (38 covers 37
 * to 39, two clean pixels) and an odd or fractional one wants a .5. This was
 * 38.5 while the stroke was 1.5. Change one and you have to change the other,
 * or the line goes soft. See STROKE for why it is 2.
 */
const TRUNK_X = SUB_X + 8;

/**
 * 2px rather than the reference's 1.5, and this is a taste call, not a fix.
 *
 * What actually made the tips look chopped was the SVG viewport clipping the
 * caps (see the `width` on the svg in skill-section-nav.tsx); that bug was
 * independent of the width and is fixed there. The width is the follow-on
 * judgement: a round cap is half the stroke, so 1.5 leaves a 0.75px dome,
 * real but under a pixel, which at 1x antialiases to something barely
 * distinguishable from a flat end. At 2px the cap is a whole pixel and the
 * roundness survives on any display, not just the 2x screens the reference is
 * usually admired on.
 *
 * Drop it back to 1.5 if the tree ever reads too heavy; the caps will still be
 * round, just quieter. Keep the coordinates in step if you do, TRUNK_X needs
 * the .5 back.
 */
const STROKE = 2;

export { ROW_X, SUB_X, ELBOW_R, ELBOW_END, CHILD_X, TRUNK_X, STROKE };

/**
 * Where a row's label starts, by outline level.
 *
 * Level 2 and deeper share one indent: `normalizeOutline` caps the outline at
 * two levels, so a level-3 row cannot reach here, and clamping is cheaper than
 * a lookup that would only ever return its last entry.
 */
export function labelX(level: number) {
  if (level === 0) return ROW_X;
  return level === 1 ? SUB_X : CHILD_X;
}

/**
 * SVG transforms resolve against the user-space origin rather than the
 * element's own box, which is what makes a `scaleY` off y=0 mean "this many
 * user units long" and a `translateY` mean "move to this row".
 */
export const SVG_ORIGIN = {
  transformBox: "view-box",
  transformOrigin: "0 0",
} as const;

/**
 * The corner and the arm that reach one row, starting on the trunk.
 *
 * The sweep is counter-clockwise so the corner bulges down and left, the way a
 * file tree draws it. Both layers are built from this one function, so the
 * line that lights up traces exactly the line that was already there, which is
 * the whole trick.
 */
export function elbowAt(y: number) {
  return `M ${TRUNK_X} ${y - ELBOW_R} A ${ELBOW_R} ${ELBOW_R} 0 0 0 ${TRUNK_X + ELBOW_R} ${y} H ${ELBOW_END}`;
}

/** The accent layer's copy, authored at y=0 because it is moved by transform. */
export const ELBOW = elbowAt(0);

/**
 * The whole grey tree as ONE path, and it has to be one path.
 *
 * Every elbow starts tangent to the trunk, so the top of its arc runs along
 * the same pixels the trunk already covers. As separate elements at 25% alpha
 * those two strokes composite, and each junction shows up as a dark blot on an
 * otherwise even line, the overlap reading as structure that isn't there. A
 * single path is stroked once, so its own subpaths cannot stack on each other
 * however much they overlap.
 *
 * The accent layer is exempt: it is fully opaque, so where its trunk and elbow
 * cross there is nothing to see, and it stays two elements because they move
 * independently.
 */
export function treePath(centers: number[], last: number) {
  return [`M ${TRUNK_X} 0 V ${last - ELBOW_R}`, ...centers.map(elbowAt)].join(
    " ",
  );
}
