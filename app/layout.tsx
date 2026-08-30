import type { Metadata } from "next";

// next/font preloads from the MODULE GRAPH, not from what the CSS uses, so an
// unused import costs a real download on every route. Three faces have been
// dropped from here for exactly that reason, so check the CSS before adding
// one back: Geist Sans; Geist Pixel Circle, when the pixel display face was
// retired (`geist/font/pixel` declares all five faces at module scope, so it
// pulled ~129 KB to use ~27 KB); and Geist Mono, once `--font-mono` moved to
// Google Sans Code and nothing read `--font-geist-mono` any more.
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

// Vendored, not fetched: SN Pro has no entry in Next's metrics table, so
// `next/font/google` couldn't build a size-adjusted fallback and every route
// reflowed when the woff2 landed. `next/font/local` measures the file instead.
//
// The file is the upright variable font subsetted to `latin` (47.9 KB). Don't
// swap in the raw TTF from the Google Fonts zip: 335 KB. No italic, so emphasis
// is synthesised — as it always was. OFL 1.1 requires the licence to travel
// with it: `app/fonts/OFL-sn-pro.txt`.
const snPro = localFont({
  src: "./fonts/sn-pro-latin.woff2",
  variable: "--font-sn-pro",
  // The file's own axis is 200-900. Declaring the range keeps this one variable
  // face instead of letting the browser synthesise the weights in between.
  weight: "200 900",
  display: "swap",
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

// The app's mono face. Both options below are load-bearing; `display: "swap"`
// used to sit here too and was removed because it is the documented default and
// the emitted @font-face carries it either way.
//
// `adjustFontFallback: false` — Google Sans Code has NO row in Next's metrics
// table (`next/dist/server/capsize-font-metrics.json`), so the default `true`
// can only fail its lookup and log "Failed to find font override values" on
// every build and dev request. It produces no size-adjusted fallback either
// way; turning it off just skips the doomed lookup.
//
// `fallback` — without it the loader emits a BARE family name
// (`--font-google-sans-code: "Google Sans Code"`), so a failed load drops
// straight to the browser default, which is proportional. Measured: `iiiii`
// 27.8px vs `MMMMM` 88.9px with no fallback, both exactly 55.0px with one. That
// is every install command, file path, `owner/repo` and diff marker in the app
// losing its columns. The stack mirrors the `geist` package's own mono config;
// only the first few entries realistically ever run.
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
        className={`${snPro.variable} ${googleSansCode.variable} font-sans antialiased`}
      >
        <div className="root">
          <Providers>{children}</Providers>
        </div>
        {process.env.NODE_ENV === "production" && (
          <OpenPanelComponent
            clientId={process.env.NEXT_PUBLIC_OPENPANEL_CLIENT_ID!}
            trackScreenViews={true}
            apiUrl="/op/analytics"
            scriptUrl="/op1.js"
          />
        )}
      </body>
    </html>
  );
}
