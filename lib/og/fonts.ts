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
 * The reads are memoized at module scope: an OG route is hit once per cache
 * miss, but a build can render many in one process, and re-reading ~750 KB of
 * ttf per image is wasteful. The promise is cached, not the result, so
 * concurrent renders share one read.
 */
type OgFont = {
  name: string;
  data: ArrayBuffer | Buffer;
  weight: 400 | 500 | 600 | 700;
  style: "normal";
};

const assetPath = (file: string) => join(process.cwd(), "assets", "og", file);

let fontsPromise: Promise<OgFont[]> | null = null;

export function loadOgFonts(): Promise<OgFont[]> {
  if (!fontsPromise) {
    fontsPromise = (async () => {
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
  }
  return fontsPromise;
}

/** Font family stacks for use in inline styles. */
export const FONT = {
  sans: "Geist",
  pixel: "Geist Pixel",
  mono: "Geist Mono",
} as const;
