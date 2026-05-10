import type { Metadata } from "next";

import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { GeistPixelCircle } from "geist/font/pixel";
// import Script from "next/script";

import { Providers } from "./providers";
import "./globals.css";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "SkillStack",
  description:
    "Discover, compare, and bundle AI coding assistant skills for your tech stack",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* <head>
      // Note: Useful for debugging React hydration issues
        <Script
          src="//unpkg.com/react-scan/dist/auto.global.js"
          crossOrigin="anonymous"
          strategy="beforeInteractive"
        />
      </head> */}
      <Suspense>
        <body
          className={`${GeistSans.variable} ${GeistMono.variable} ${GeistPixelCircle.variable} font-sans antialiased`}
        >
          <div className="root">
            <Providers>{children}</Providers>
          </div>
        </body>
      </Suspense>
    </html>
  );
}
