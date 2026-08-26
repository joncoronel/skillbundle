/**
 * Style tokens shared between the catalog listing pages and the client
 * components that render the same lists.
 *
 * These live in `lib/` rather than beside the components on purpose. Both are
 * plain functions/strings with no React in them, and the listing pages that
 * need them are Server Components — putting them in a `"use client"` module
 * makes calling them from a page a build-time error ("Attempted to call
 * LIST_STACK from the server but it is on the client"). That is not a type
 * error, so `pnpm lint`/`typecheck` pass and only `next build` catches it.
 * Keep this file free of `"use client"` and of React imports.
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
 * A catalog list is THREE pieces: a panel that frames the whole run, a stack
 * that lays the rows out, and a row that draws its own bottom divider.
 *
 * The rows used to separate on fill alone — each one a `card`-filled slab with
 * a gap showing the `field` between them. That works only where the ground is
 * `surface-1`, and light mode has no headroom above `surface-3`: `--surface-3`
 * through `--surface-8` are all `oklch(1 0 0)`. So the same list inside any
 * raised container (the leaderboard sheet is `level={5}`) was white rows on a
 * white sheet, with nothing left to see. Dark hid it — there the ladder really
 * does step — but backwards, with the row DARKER than the sheet it sat on,
 * the inverse of the page relationship.
 *
 * A divider needs no fill delta, so it survives any ground. The panel then
 * frames the run once instead of asking thirty rows to each define themselves,
 * and inside a container that already frames its contents you use the stack
 * without it.
 */

/**
 * Frames a whole list as one object, in the one direction its ground leaves
 * open.
 *
 * `overflow-hidden` is load-bearing in both: a selected row's fill runs the
 * full width of the panel, so the panel is what rounds the first and last
 * selected rows. Without it they land square.
 *
 * No border and no shadow on either. One tonal step reads at panel scale where
 * it did not at row scale, and an edge here would be the second elevation
 * signal §5 forbids.
 *
 * **RAISED** — over the `surface-1` page. The default.
 *
 * **SUNKEN** — over anything already raised: a sheet, a dialog, a card. It goes
 * DOWN because light mode has no room to go up (DESIGN.md §5, The Light Ceiling
 * Rule: `--surface-3` through `--surface-8` are all `oklch(1 0 0)`, so a
 * `card` panel inside a `level={5}` sheet is white on white). `muted` is the
 * one step that reads in BOTH themes from there — 0.94 under light's 1.0, 0.24
 * under dark's 0.321 — where `surface-1` would be a 3% whisper in light and an
 * 11% drop in dark, which is not the same object in the two themes.
 */
export const LIST_PANEL = "overflow-hidden rounded-2xl bg-card";
export const LIST_PANEL_SUNKEN = "overflow-hidden rounded-2xl bg-muted";

/**
 * The container that stacks catalog rows.
 *
 * `grid-cols-1` (minmax(0,1fr)) keeps the track shrinkable — a bare `grid`
 * sizes its implicit track to the widest row's intrinsic width, overflowing the
 * viewport on mobile instead of letting each row's internal truncation kick in.
 */
export const LIST_STACK = "grid grid-cols-1";

/**
 * A row in a stacked list: no fill of its own (the panel supplies it) and a
 * hairline under every row but the last.
 *
 * The divider is a pseudo-element rather than a `border-b` because it is INSET
 * — `inset-x-4` puts it flush with the row's own `px-4` content, so it starts
 * at the checkbox and stops at the install count instead of running out to the
 * panel's edge. A full-bleed rule cuts the panel into slices; an inset one
 * separates the content and leaves the panel whole, which is the whole reason
 * to frame the run in the first place.
 *
 * It is drawn on the BOTTOM of each row, not the top, purely so `not-last`
 * expresses the "no rule under the final row" case in one variant.
 */
export const LIST_ROW =
  "relative not-last:after:pointer-events-none not-last:after:absolute not-last:after:inset-x-4 not-last:after:bottom-0 not-last:after:h-px not-last:after:bg-border";
