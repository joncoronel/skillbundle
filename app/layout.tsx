import type { Metadata } from "next";

// next/font preloads what it finds in the MODULE GRAPH, not what the CSS uses,
// so an unused import costs a real font download on every route. `GeistSans`
// was dropped for exactly that.
//
// `geist/font/pixel` has the same problem in a worse shape — it declares all
// five pixel faces at module scope, so importing Circle downloads ~129 KB to
// use ~27 KB — and is imported anyway, deliberately. The alternative is
// `next/font/google`'s `Geist_Pixel`, which ships the five shapes as one
// variable family on an `ELSH` axis and is the far smaller download, but has no
// entry in Next's font-metrics table: every build and every dev request logs
// "Failed to find font override values for font `Geist Pixel`". That warning
// cannot be turned off on the Google loader, because `adjustFontFallback` only
// picks a different row from the same table the font is missing from. The
// package reaches next/font/local, where the flag means something, and sets
// `adjustFontFallback: false` on each face itself.
//
// So this trades ~100 KB of unused font for a clean console. TODO.md carries
// the fix that costs neither (vendor the one Circle face), rather than leaving
// the 100 KB as a cost nothing outside this comment records.
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

// Vendored rather than fetched, because SN Pro has no entry in Next's metrics
// table and `next/font/google` builds its size-adjusted fallback face from that
// table — so every route reflowed its body text when the woff2 landed.
// `next/font/local` measures the file instead, which works for any font.
//
// The file is the upright variable font subsetted to `latin`, matching what
// Google served (47.9 KB vs 46.1 KB). Do not swap in the raw TTF from the Google
// Fonts zip: 335 KB. No italic — none was requested before either, so emphasis
// has always been synthesised.
//
// OFL 1.1 requires the licence to travel with the font: `app/fonts/OFL-sn-pro.txt`.
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
