import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Fonts for `ImageResponse`. Satori needs the raw font bytes (ttf/otf/woff —
 * NOT woff2), so the brand faces are committed under `assets/og/` as ttf:
 *   - Geist Sans (400/500/600/700) — body + headings, copied from `geist`.
 *   - Geist Pixel Circle (400) — the display wordmark, the project's fixed
 *     visual identity. It ships only as woff2 in the `geist` package, so it
 *     was decompressed to ttf once and committed here.
 *
 * `next.config.ts` lists `assets/og/**` in `outputFileTracingIncludes` so the
 * files travel with the serverless functions that render these images.
 *
 * The reads are kicked off once at module load (not on first render). Under
 * Cache Components, an `await readFile()` reached during a render counts as an
 * "async file system operation" and flips the route dynamic — which is what
 * made the otherwise-static section OG routes (no params, no data) land as `ƒ`
 * non-deterministically, depending on which one warmed this cache first in each
 * build worker. Initiating the reads at module scope keeps them out of the
 * render's dynamic-tracking, so those routes prerender as `○`. The single
 * shared promise is also reused across every render in the process.
 */
type OgFont = {
  name: string;
  data: ArrayBuffer | Buffer;
  weight: 400 | 500 | 600 | 700;
  style: "normal";
};

const assetPath = (file: string) => join(process.cwd(), "assets", "og", file);

const fontsPromise: Promise<OgFont[]> = (async () => {
  const [regular, medium, semibold, bold, pixel, mono] = await Promise.all([
    readFile(assetPath("Geist-Regular.ttf")),
    readFile(assetPath("Geist-Medium.ttf")),
    readFile(assetPath("Geist-SemiBold.ttf")),
    readFile(assetPath("Geist-Bold.ttf")),
    readFile(assetPath("GeistPixel-Circle.ttf")),
    readFile(assetPath("GeistMono-Regular.ttf")),
  ]);
  return [
    { name: "Geist", data: regular, weight: 400, style: "normal" },
    { name: "Geist", data: medium, weight: 500, style: "normal" },
    { name: "Geist", data: semibold, weight: 600, style: "normal" },
    { name: "Geist", data: bold, weight: 700, style: "normal" },
    { name: "Geist Pixel", data: pixel, weight: 400, style: "normal" },
    { name: "Geist Mono", data: mono, weight: 400, style: "normal" },
  ];
})();

export function loadOgFonts(): Promise<OgFont[]> {
  return fontsPromise;
}

/** Font family stacks for use in inline styles. */
export const FONT = {
  sans: "Geist",
  pixel: "Geist Pixel",
  mono: "Geist Mono",
} as const;
