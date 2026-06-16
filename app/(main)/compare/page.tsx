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

// Kept fully static so the route stays a CDN-served shell. The OG image is the
// generic compare card from the colocated `opengraph-image.tsx` (every
// `?skills=` variant shares it). A per-combo card would mean reading
// searchParams in generateMetadata, which forces per-request dynamic rendering
// — a trade-off this high-cardinality, rarely-revisited page deliberately
// avoids.
export const metadata: Metadata = {
  title: "Compare Skills",
  description: "Compare AI coding assistant skills side by side.",
  // Every `?skills=` variant serves this same shell — point crawlers at the
  // bare route so comparison links don't index as thin duplicate pages.
  alternates: { canonical: "/compare" },
};

// State-neutral fallback: the columns depend entirely on the search param
// (unknown at prerender), so this renders the toolbar row plus one panel at
// the columns' final height — content subdivides that area in place.
function CompareFallback() {
  return (
    <div>
      <div className="flex h-7 items-center justify-between gap-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-48 max-w-full" />
      </div>
      <Skeleton className="mt-4 h-[min(60vh,44rem)] w-full rounded-2xl" />
    </div>
  );
}

export default function ComparePage() {
  return (
    <main className="mx-auto max-w-7xl px-4 pt-12 pb-24">
      <header>
        <h1 className="font-display text-[clamp(2.5rem,5vw,4rem)] font-medium tracking-tight leading-hero text-balance">
          Compare.
        </h1>
        <p className="mt-3 max-w-prose text-sm text-muted-foreground">
          Installs, rank, audits, and docs side by side, with every skill&apos;s
          install trend on one chart. Pick up to three and see which earns the
          spot in your bundle.
        </p>
      </header>
      <div className="mt-10">
        <Suspense fallback={<CompareFallback />}>
          <CompareContent />
        </Suspense>
      </div>
      {/* The floating bundle selection bar is mounted by the (main) layout
          (GlobalBundleBar), so the instance carried over from the discovery
          surfaces persists here. */}
    </main>
  );
}
