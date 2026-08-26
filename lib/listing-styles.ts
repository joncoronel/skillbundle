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
 * Corner/border classes for a row inside a stacked list (SkillRowGrid, repo
 * match results): first row keeps top corners, last keeps bottom corners,
 * middles are square, and every non-first row drops its top border so the
 * stack reads as one framed unit.
 *
 * Returns `undefined` for a single-row list, which keeps all four corners — the
 * case hand-rolled copies of this logic used to forget.
 */
export function rowPositionClassName(
  index: number,
  length: number,
): string | undefined {
  if (length === 1) return undefined;
  if (index === 0) return "rounded-b-none";
  if (index === length - 1) return "rounded-t-none border-t-0";
  return "rounded-none border-t-0";
}
