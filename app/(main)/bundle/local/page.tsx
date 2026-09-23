import type { Metadata } from "next";
import { Suspense } from "react";
import { BundleShell } from "../[id]/loading";
import { LocalBundleView } from "./local-bundle-view";

// A bundle saved in this browser while signed out (lib/local-bundles.ts). The
// page is static: the bundle lives in localStorage, so there is nothing for a
// server to render per bundle, and the id rides in `?id=` like `/compare`'s
// skills. `useSearchParams` is what puts the view behind Suspense. The fallback
// is the account page's shell in its owner form: a browser bundle's viewer is
// always its owner, so its action row and Edit skills are always there.
export const metadata: Metadata = {
  title: "Saved bundle",
  // Only ever meaningful in the browser that saved it.
  robots: { index: false, follow: false },
};

export default function LocalBundlePage() {
  return (
    <Suspense fallback={<BundleShell owner />}>
      <LocalBundleView />
    </Suspense>
  );
}
