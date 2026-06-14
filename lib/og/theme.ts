/**
 * OG image design tokens.
 *
 * `next/og` renders through Satori, which does NOT understand `oklch()`,
 * `color-mix()`, or CSS variables — only literal sRGB values. These hexes are
 * the brand palette (defined in `app/globals.css` as OKLCH) converted once to
 * sRGB so social cards match the app exactly. Keep them in sync if the brand
 * primary or dark surfaces change.
 *
 * The OG surface is always the dark theme: high-contrast near-black with the
 * single blue accent reads best as a shared-link thumbnail and matches the
 * Nothing-OS industrial side of the brand references.
 */
export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

export const og = {
  /** Page background — `--surface-1` dark, pushed slightly deeper. */
  bg: "#0a0b0d",
  /** First raised surface (chips, cards). `--surface-2` dark. */
  surface: "#161719",
  /** Second raised surface. `--surface-3` dark. */
  surfaceHi: "#1d1e20",
  /** Hairline borders — `oklch(1 0 0 / 10%)` flattened onto bg. */
  border: "#2a2b2e",
  borderStrong: "#3a3b3f",
  /** `--foreground` dark. */
  fg: "#eaebee",
  /** `--muted-foreground` dark. */
  muted: "#a7a7aa",
  /** Dimmer still — captions, footer. */
  dim: "#707174",
  /** Brand primary `oklch(0.6 0.2 250)`. */
  primary: "#0081f1",
  /** Lifted primary for text/icons on dark (`oklch(0.7 0.17 250)`). */
  primaryBright: "#39a3ff",
  /** Semantic foregrounds (dark theme audit pills). */
  success: "#61bd67",
  warning: "#dbb155",
  danger: "#ff847d",
  info: "#49a9ff",
} as const;
