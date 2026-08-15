import type { Metadata } from "next";

// GeistSans is deliberately NOT imported. `--font-sans` is SN Pro and nothing
// reads `--font-geist-sans`, but next/font decides preloading from the module
// graph rather than from CSS usage — so merely importing it made every route
// emit a highest-priority `<link rel="preload" as="font">` for a face no
// element uses, competing with SN Pro's own preload before first paint.
import { GeistMono } from "geist/font/mono";
import { GeistPixelCircle } from "geist/font/pixel";

import localFont from "next/font/local";

import { OpenPanelComponent } from "@openpanel/nextjs";

import { Providers } from "./providers";
import { SITE_URL } from "@/lib/site-url";
import "./globals.css";

// metadataBase makes every relative OG/Twitter image URL absolute (required by
// crawlers). The origin itself lives in lib/site-url.ts, shared with the
// robots and sitemap routes — those emit text and XML, so nothing resolves
// relative URLs for them and they need the same value spelled out.

// Vendored, not fetched, and the reason is the metrics table.
//
// `next/font/google` looks a family up in the table Next ships (1753 fonts) and
// uses those numbers to synthesise a size-adjusted fallback face, so the swap at
// `display: swap` does not move the page. SN Pro is not in that table — Geist,
// Inter and Roboto are, which is why this never comes up on other projects — so
// no fallback face could be built, and every route reflowed its body text when
// the woff2 landed. `adjustFontFallback: false` only silenced the warning about
// it.
//
// `next/font/local` measures the file itself instead of reading the table, so it
// can build that face for any font. Everything else is identical: still
// self-hosted from our own origin at build time, still zero runtime cost, still
// one `<link rel="preload">`. It also drops a build-time dependency on Google's
// CDN, which AGENTS.md already flags as a fragility for `pnpm build`.
//
// The file is the upright variable font, subsetted to the same `latin` range
// Google served: 47.9 KB against the 46.1 KB the browser actually downloaded
// before. The raw TTF from the Google Fonts zip is 335 KB and would have cost
// more in download than the reflow ever cost in layout shift. Italic is
// deliberately absent — the previous setup requested none either, so emphasis
// has always been synthesised, and shipping it would double the payload to fix
// nothing.
//
// OFL 1.1 requires the copyright notice and licence to travel with the font.
// `app/fonts/OFL.txt` is that copy; do not move one without the other.
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
        className={`${GeistMono.variable} ${GeistPixelCircle.variable} ${snPro.variable} font-sans antialiased`}
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
