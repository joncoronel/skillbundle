import type { Metadata } from "next";

import { GeistSans } from "geist/font/sans";
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
// replaced the fallback. GeistSans gets a generated `"GeistSans Fallback"` face
// with `size-adjust: 106.28%` over `local("Arial")`, while `body` resolved to
// the bare family `"SN Pro"` — so a slow or failed load dropped straight to the
// browser default with no metric matching at all. Naming the stack here gets
// back a sane fallback; what stays lost is the size-adjust, which cannot be
// computed for a font Next does not know.
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
        className={`${GeistSans.variable} ${GeistMono.variable} ${GeistPixelCircle.variable} ${snPro.variable} font-sans antialiased`}
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
