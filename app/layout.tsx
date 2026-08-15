import type { Metadata } from "next";

// GeistSans is deliberately NOT imported. `--font-sans` is SN Pro and nothing
// reads `--font-geist-sans`, but next/font decides preloading from the module
// graph rather than from CSS usage — so merely importing it made every route
// emit a highest-priority `<link rel="preload" as="font">` for a face no
// element uses, competing with SN Pro's own preload before first paint.
import { GeistMono } from "geist/font/mono";
import { GeistPixelCircle } from "geist/font/pixel";

import { SN_Pro } from "next/font/google";

import { OpenPanelComponent } from "@openpanel/nextjs";

import { Providers } from "./providers";
import { SITE_URL } from "@/lib/site-url";
import "./globals.css";

// metadataBase makes every relative OG/Twitter image URL absolute (required by
// crawlers). The origin itself lives in lib/site-url.ts, shared with the
// robots and sitemap routes — those emit text and XML, so nothing resolves
// relative URLs for them and they need the same value spelled out.

// `adjustFontFallback: false` plus an explicit `fallback`, because Next has no
// metrics for SN Pro. Left on the default (`true`) it tries to synthesise a
// size-adjusted fallback face, fails to find the font in its metrics table, and
// logs "Failed to find font override values" on every render.
//
// That warning was worth acting on rather than silencing: it also meant nothing
// replaced the fallback. `body` resolved to the bare family `"SN Pro"`, so a
// slow or failed load dropped straight to the browser default. Naming the stack
// here gets a sane fallback back.
//
// KNOWN COST, not yet paid off: the size-adjust is still missing. The previous
// body face got a generated `"GeistSans Fallback"` — `size-adjust: 106.28%`,
// `ascent-override: 94.56%` over `local("Arial")` — because Next has metrics
// for it, so the swap at `display: swap` did not move the page. SN Pro is not
// in `next/dist/server/capsize-font-metrics.json`, and `next/font/google`
// cannot compute metrics for a family it has no entry for, so every route now
// reflows its body text when the woff2 lands.
//
// The fix is `next/font/local` with a vendored woff2: that loader measures the
// file with fontkit instead of reading the table, so it generates the adjusted
// face this one structurally cannot — and it drops the build-time dependency on
// Google's CDN. It needs the font binary committed, which is a call for the
// repo owner; TODO.md carries it.
const snPro = SN_Pro({
  subsets: ["latin"],
  variable: "--font-sn-pro",
  adjustFontFallback: false,
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
