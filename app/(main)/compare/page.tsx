import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { CompareContent } from "./compare-content";

// The page is static — the compared skills live in the `skills` search param,
// read client-side via nuqs, and each column fetches its skill from Convex on
// the client. Comparison combos are high-cardinality and rarely revisited, so
// neither per-combo ISR pages nor per-request dynamic renders pay off; the
// static shell is prefetchable and adding/removing columns is a shallow URL
// update with no navigation.

export const metadata: Metadata = {
  title: "Compare Skills",
  description: "Compare AI coding assistant skills side by side.",
  // Every `?skills=` variant serves this same shell — point crawlers at the
  // bare route so comparison links don't index as thin duplicate pages.
  alternates: { canonical: "/compare" },
};

// State-neutral fallback: the columns depend entirely on the search param
// (unknown at prerender), so this renders the page chrome plus one panel at
// the columns' final height — content subdivides that area in place.
function CompareFallback() {
  return (
    <div>
      <Skeleton className="h-6 w-44" />
      <div className="mt-2">
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <Skeleton className="mt-4 h-[min(60vh,44rem)] w-full rounded-xl" />
    </div>
  );
}

export default function ComparePage() {
  return (
    <main className="mx-auto max-w-7xl px-4 pt-12 pb-24">
      <h1 className="font-display text-2xl font-semibold tracking-tight mb-8">
        Compare Skills
      </h1>
      <Suspense fallback={<CompareFallback />}>
        <CompareContent />
      </Suspense>
      {/* The floating bundle selection bar is mounted by the (main) layout
          (GlobalBundleBar), so the instance carried over from the discovery
          surfaces persists here. */}
    </main>
  );
}
