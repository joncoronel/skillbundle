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
 * The container that stacks catalog rows.
 *
 * `grid-cols-1` (minmax(0,1fr)) keeps the track shrinkable — a bare `grid`
 * sizes its implicit track to the widest row's intrinsic width, overflowing the
 * viewport on mobile instead of letting each row's internal truncation kick in.
 *
 * The 6px gap is what separates the rows. Rows used to be welded into one
 * framed unit (square middle corners, dropped top borders), which needed a
 * per-index class to know where it sat in the stack; a gapped list needs no
 * such thing, because every row is the same object regardless of position.
 */
export const LIST_STACK = "grid grid-cols-1 gap-1.5";

/**
 * The frame every row in a stacked list shares: fill and corner, no border.
 *
 * Elevation is declared once (§5 The Material Depth Rule) and here it is the
 * tonal step alone — `card` is `surface-3`, a rung above the `surface-1` field
 * the gap shows through. `rounded-lg` (12px) is the list-row radius (§6); the
 * old `rounded-2xl` belonged to the welded stack, which was a panel.
 *
 * Uniform on every row, deliberately: the first and last rows get the SAME
 * corner as the middles. A larger outer corner would assert an enclosing frame,
 * and once the rows are separated there is no frame left to belong to.
 *
 * Pair with `LIST_STACK` on the container so skeleton rows and real rows are
 * framed by the same string rather than by two copies that drift.
 */
export const LIST_ROW_FRAME = "rounded-lg bg-card text-card-foreground";
