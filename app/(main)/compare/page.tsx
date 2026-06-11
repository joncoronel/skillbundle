import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { CompareView } from "./compare-view";

export const metadata: Metadata = {
  title: "Compare Skills",
  description: "Compare AI coding assistant skills side by side.",
};

// State-neutral fallback: the real content depends entirely on the `skills`
// search param (unknown at prerender), so this can't mirror a "default state"
// like the other pages — a generic two-column skeleton avoids both a blank
// page and a wrong-state flash.
function CompareSkeleton() {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {[1, 2].map((i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-32 w-full" />
        </div>
      ))}
    </div>
  );
}

export default function ComparePage() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-12 pb-20">
      <h1 className="font-display text-2xl font-semibold tracking-tight mb-8">
        Compare Skills
      </h1>
      <Suspense fallback={<CompareSkeleton />}>
        <CompareView />
      </Suspense>
    </main>
  );
}
