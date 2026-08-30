import type { Metadata } from "next";

// next/font preloads from the MODULE GRAPH, not from what the CSS uses, so an
// unused import costs a real download on every route (`GeistSans` was dropped
// for that). `geist/font/pixel` declares all five faces at module scope, so
// importing Circle pulls ~129 KB to use ~27 KB — accepted deliberately, because
// `next/font/google`'s smaller `Geist_Pixel` has no entry in Next's metrics
// table and logs "Failed to find font override values" on every build and dev
// request, unsilenceable (`adjustFontFallback` only picks another row from the
// table it's missing from). TODO.md has the fix that costs neither.
import { GeistMono } from "geist/font/mono";
import { GeistPixelCircle } from "geist/font/pixel";
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

const googleSans = Google_Sans_Code({
  subsets: ["latin"],
  variable: "--font-google-sans-code",
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
        className={`${GeistMono.variable} ${GeistPixelCircle.variable} ${snPro.variable} ${googleSans.variable} font-sans antialiased`}
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
