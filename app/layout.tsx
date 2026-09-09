import type { Metadata } from "next";

// next/font preloads from the MODULE GRAPH, not from what the CSS uses, so an
// unused import costs a real download on every route. Three faces have been
// dropped from here for that reason; check the CSS before adding one back.
import { Google_Sans_Code } from "next/font/google";

import localFont from "next/font/local";

import { OpenPanelComponent } from "@openpanel/nextjs";

import { Providers } from "./providers";
import { SITE_URL } from "@/lib/site-url";
import "./globals.css";

// metadataBase makes every relative OG/Twitter image URL absolute (required by
// crawlers). The origin itself lives in lib/site-url.ts, shared with the
// robots and sitemap routes — those emit text and XML, so nothing resolves
// relative URLs for them and they need the same value spelled out.

// Vendored, not fetched: Open Runde isn't on Google Fonts at all, and even if
// it were it has no entry in Next's metrics table, so `next/font/google`
// couldn't build a size-adjusted fallback. `next/font/local` measures the file.
//
// FOUR FILES, NOT ONE. Open Runde ships static instances and no variable font,
// which is the whole shape of this config: each weight is a separate ~26 KB
// download and `next/font` preloads every one of them on every route, used or
// not. So adding a fifth is a real cost, and any weight NOT listed here fails
// quietly rather than loudly: CSS matches the nearest available face instead of
// synthesising, so it renders at a neighbouring weight and looks almost right.
// 700 is carried for exactly that reason. It briefly was not, on a 43 KB
// per-face measurement that turned out to be uncompressed output.
//
// The files are cut from the upstream release by `scripts/build-open-runde.py`,
// which also synthesises the `tnum` the family lacks — read its header before
// regenerating them. No italic, so emphasis is synthesised, as it always was.
// OFL 1.1 requires the licence to travel with them: `app/fonts/OFL-open-runde.txt`.
const openRunde = localFont({
  src: [
    { path: "./fonts/open-runde-400-latin.woff2", weight: "400" },
    { path: "./fonts/open-runde-500-latin.woff2", weight: "500" },
    { path: "./fonts/open-runde-600-latin.woff2", weight: "600" },
    { path: "./fonts/open-runde-700-latin.woff2", weight: "700" },
  ],
  variable: "--font-open-runde",
  display: "swap",
  // No `size-adjust` and no `adjustFontFallback`, both deliberately. The face
  // runs at its natural size, so the ramp in globals.css renders about a tenth
  // above its nominal rem values; leaving `adjustFontFallback` at its 'Arial'
  // default is what keeps Next generating the metric-matched fallback that
  // holds the layout still. DESIGN.md §3 has the measurements and rules out
  // both a `size-adjust` and ranking a `local("Inter")` ahead of that fallback
  // — read it before adding either back.
  fallback: [
    "system-ui",
    "-apple-system",
    "Segoe UI",
    "Roboto",
    "Helvetica Neue",
    "Arial",
    "sans-serif",
  ],
});

// The app's mono face. Both options below are load-bearing. Don't add
// `display: "swap"`: it is the documented default and the @font-face carries it
// either way.
//
// `adjustFontFallback: false` — Google Sans Code has no row in Next's metrics
// table (`next/dist/server/capsize-font-metrics.json`), so the default `true`
// can only fail its lookup and log "Failed to find font override values" on
// every build and dev request. It yields no size-adjusted fallback either way.
//
// `fallback` — without it the loader emits a bare family name, so a failed load
// drops to the browser default, which is proportional. Measured at 20px: `iiiii`
// 27.8px vs `MMMMM` 88.9px bare, both 55.0px with the stack. That is every
// install command, file path and diff marker losing its columns.
const googleSansCode = Google_Sans_Code({
  subsets: ["latin"],
  variable: "--font-google-sans-code",
  adjustFontFallback: false,
  fallback: [
    "ui-monospace",
    "SFMono-Regular",
    "Menlo",
    "Monaco",
    "Liberation Mono",
    "DejaVu Sans Mono",
    "Courier New",
    "monospace",
  ],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "SkillBundle",
  description:
    "Discover, compare, and bundle AI coding assistant skills for your tech stack",
  // X/Twitter renders large-format cards; the generated twitter-image files
  // supply the actual artwork.
  twitter: {
    card: "summary_large_image",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${openRunde.variable} ${googleSansCode.variable} font-sans antialiased`}
      >
        <div className="root">
          <Providers>{children}</Providers>
        </div>
        {process.env.NODE_ENV === "production" && (
          <OpenPanelComponent
            clientId={process.env.NEXT_PUBLIC_OPENPANEL_CLIENT_ID!}
            trackScreenViews={true}
            apiUrl="/api/op"
            scriptUrl="/api/op/s"
          />
        )}
      </body>
    </html>
  );
}
