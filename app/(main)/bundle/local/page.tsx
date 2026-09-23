import type { Metadata } from "next";
import { Suspense } from "react";
import { BundleShell } from "../[id]/loading";
import { LocalBundleView } from "./local-bundle-view";

// A bundle saved in this browser. Static, with the id in `?id=` like
// `/compare`; the fallback is the owner form of the account page's shell.
export const metadata: Metadata = {
  title: "Saved bundle",
  robots: { index: false, follow: false },
};

export default function LocalBundlePage() {
  return (
    <Suspense fallback={<BundleShell owner />}>
      <LocalBundleView />
    </Suspense>
  );
}
