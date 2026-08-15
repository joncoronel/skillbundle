import type { Metadata } from "next";

// next/font preloads what it finds in the MODULE GRAPH, not what the CSS uses,
// so an unused import costs a real font download on every route. `GeistSans`
// and `geist/font/pixel` were both dropped for that (the latter declares five
// faces in one module). `geist/font/mono` declares one, so it stays.
import { GeistMono } from "geist/font/mono";

import localFont from "next/font/local";
import { Geist_Pixel } from "next/font/google";

import { OpenPanelComponent } from "@openpanel/nextjs";

import { Providers } from "./providers";
import { SITE_URL } from "@/lib/site-url";
import "./globals.css";

// metadataBase makes every relative OG/Twitter image URL absolute (required by
// crawlers). The origin itself lives in lib/site-url.ts, shared with the
// robots and sitemap routes — those emit text and XML, so nothing resolves
// relative URLs for them and they need the same value spelled out.

// Google, not `geist/font/pixel`: the package ships the five shapes as five
// files and one import pulls all of them (129 KB downloaded, 27 KB used).
// Google ships them as ONE variable family on an `ELSH` axis, so `axes` is
// load-bearing — drop it and the axis flattens to its default, Square. The shape
// itself is pinned in globals.css. Build logs a harmless "Failed to find font
// override values": Geist Pixel has no metrics entry, so no fallback face can be
// built. `adjustFontFallback` does not help — it only selects from that same
// table. (It IS meaningful in the `geist` package, which uses next/font/local
// where it defaults to Arial. Different loader; do not carry the flag across.)
const geistPixel = Geist_Pixel({
  subsets: ["latin"],
  axes: ["ELSH"],
  variable: "--font-geist-pixel",
  display: "swap",
});

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
        className={`${GeistMono.variable} ${geistPixel.variable} ${snPro.variable} font-sans antialiased`}
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
