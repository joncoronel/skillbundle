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
export const LISTING_TITLE_SCALE = "text-display-sm";

/**
 * Row fill for a stacked list on a RAISED ground (the leaderboard sheet) rather
 * than on the page. Light-only: in light a `card` row inside a `level={5}`
 * sheet is white on white, and `muted` is the only step left (DESIGN.md §5,
 * The Light Ceiling Rule). Dark's ladder steps at every rung, so its row
 * already sits below the sheet.
 *
 * Painted THROUGH `--row-surface` rather than as `dark:bg-card`, and do not
 * "simplify" it back: a `dark:bg-*` carries the same (0,2,0) specificity as
 * `has-data-checked:bg-*`, so the two race on source order — `dark:` won, and
 * a selected row in the dark sheet silently kept its unselected fill. Keeping
 * the `bg-*` unvariant also means the fill and the selection tint read one
 * variable and cannot drift.
 */
export const LIST_ROW_ON_RAISED =
  "bg-(--row-surface) [--row-surface:var(--muted)] dark:[--row-surface:var(--card)]";

/**
 * Corner/border classes for a row inside a stacked list (SkillRowGrid, repo
 * match results): first row keeps top corners, last keeps bottom corners,
 * middles are square, and the only borders left are the ones BETWEEN rows.
 *
 * This SUBTRACTS from the caller's base `border` (all four sides): every row
 * loses left and right, the first loses its top, the last loses everything.
 * What survives is `length - 1` hairlines, each on a seam and none on the
 * perimeter.
 *
 * Bottom edge rather than top, so the selection tint stays continuous: a
 * checked row colours the seam below it via `has-data-checked:border-primary/30`
 * and the seam above it via the previous row's `:has(+ label [data-checked])`.
 * CSS has no previous-sibling selector, so a top-edge version could only ever
 * tint one of the two.
 *
 * Returns `border-0` for a single-row list, which keeps all four corners — the
 * case hand-rolled copies of this logic used to forget.
 */
export function rowPositionClassName(index: number, length: number): string {
  if (length === 1) return "border-0";
  if (index === 0) return "rounded-b-none border-x-0 border-t-0";
  if (index === length - 1) return "rounded-t-none border-0";
  return "rounded-none border-x-0 border-t-0";
}
