/**
 * Style tokens shared between the catalog listing pages and the client
 * components that render the same lists.
 *
 * These live in `lib/` rather than beside the components on purpose. Both are
 * plain functions/strings with no React in them, and the listing pages that
 * need them are Server Components — putting them in a `"use client"` module
 * makes calling them from a page a build-time error ("Attempted to call
 * rowPositionClassName() from the server but it is on the client"). That is not
 * a type error, so `pnpm lint`/`typecheck` pass and only `next build` catches
 * it. Keep this file free of `"use client"` and of React imports.
 */

/**
 * The catalog listing pages' title type scale.
 *
 * Each of `/[org]`, `/[org]/[repo]` and `/site/[source]` renders its title
 * twice: once as the real `<h1>` and once as the Skeleton standing in for it
 * while `params` resolves. Those two have to agree exactly or the heading
 * changes size when it lands — and under Partial Prefetching the skeleton is
 * the shared App Shell, so that swap is the first thing every client navigation
 * into those routes shows.
 */
export const LISTING_TITLE_SCALE =
  "font-display text-[clamp(2.25rem,5vw,3.5rem)] leading-hero";

/**
 * Row fill for a stacked list sitting on a RAISED ground — the leaderboard
 * sheet — rather than on the page.
 *
 * Only light needs it. Light mode has three tonal steps and no more:
 * `--surface-3` through `--surface-8` are all `oklch(1 0 0)`, so a `card` row
 * inside a `level={5}` sheet is white on white, and with no outer border left
 * to draw its perimeter the list has nothing separating it from the sheet at
 * all. Stepping DOWN to `muted` is the only direction light leaves open, and
 * 0.94 under the sheet's 1.0 is the same 6% step the composer's frame uses
 * against the page.
 *
 * Dark keeps `card` because dark already solves this by itself: the ladder
 * really does step at every rung there, so the row's 0.264 sits below the
 * sheet's 0.321 without help. Painting `muted` in both themes would move dark
 * for no reason.
 *
 * See DESIGN.md §5, The Light Ceiling Rule.
 */
export const LIST_ROW_ON_RAISED = "bg-muted dark:bg-card";

/**
 * Corner/border classes for a row inside a stacked list (SkillRowGrid, repo
 * match results): first row keeps top corners, last keeps bottom corners,
 * middles are square, and the only borders left anywhere are the ones BETWEEN
 * rows. The stack still reads as one unit; it just has no outline around it,
 * so the `card` fill draws its own silhouette against the page.
 *
 * Each caller's base class supplies `border` (all four sides at the hairline
 * width, coloured by the `*` rule in globals.css). What this function does is
 * subtract: every row loses its left and right, the first loses its top, and
 * the last loses everything. What survives is one bottom border per row except
 * the last — exactly `length - 1` hairlines for `length` rows, each sitting on
 * a seam between two of them and none on the perimeter.
 *
 * Keeping the bottom edge rather than the top is what lets the selection tint
 * stay continuous: a checked row colours the seam BELOW it through its own
 * `has-data-checked:border-primary/30`, and the seam ABOVE it through the
 * previous row's `:has(+ label [data-checked])`. There is no previous-sibling
 * selector, so the top-edge version of this could only ever tint one of the
 * two.
 *
 * Returns `border-0` for a single-row list, which keeps all four corners and
 * draws no line at all — the case hand-rolled copies of this logic used to
 * forget.
 */
export function rowPositionClassName(index: number, length: number): string {
  if (length === 1) return "border-0";
  if (index === 0) return "rounded-b-none border-x-0 border-t-0";
  if (index === length - 1) return "rounded-t-none border-0";
  return "rounded-none border-x-0 border-t-0";
}
