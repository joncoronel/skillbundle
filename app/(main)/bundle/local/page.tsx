import type { Metadata } from "next";
import { Suspense } from "react";
import BundleLoading from "../[id]/loading";
import { LocalBundleView } from "./local-bundle-view";

// A bundle saved in this browser while signed out (lib/local-bundles.ts). The
// page is static: the bundle lives in localStorage, so there is nothing for a
// server to render per bundle, and the id rides in `?id=` like `/compare`'s
// skills. `useSearchParams` is what puts the view behind Suspense, and the
// account bundle page's own loading shell is the fallback because the view
// renders the same layout.
export const metadata: Metadata = {
  title: "Saved bundle",
  // Only ever meaningful in the browser that saved it.
  robots: { index: false, follow: false },
};

export default function LocalBundlePage() {
  return (
    <Suspense fallback={<BundleLoading />}>
      <LocalBundleView />
    </Suspense>
  );
}
