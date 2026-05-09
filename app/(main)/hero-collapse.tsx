"use client";

import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { useCollapsibleHeight } from "@/hooks/cubby-ui/use-collapsible-height";

// Owns the URL subscription so typing in the search input only re-renders the
// hero wrapper. <main>/<SkillExplorer> live as siblings of this component in
// HomeContent and stay untouched on URL ticks.
export function HeroCollapse({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode") ?? "text";
  const query = searchParams.get("q") ?? "";
  const repoUrl = searchParams.get("repo") ?? "";
  const searchActive =
    mode === "text" ? query.trim().length > 0 : repoUrl.trim().length > 0;
  const { ref, height } = useCollapsibleHeight();

  // Height transition lasts 200ms; the inner opacity fade runs shorter (150ms)
  // so the tagline dims before the section shrinks, avoiding an abrupt
  // disappearance.
  return (
    <div
      className="max-sm:duration-0 max-sm:transition-none transition-[height] duration-200 ease-out-cubic overflow-hidden"
      style={{ height: searchActive ? 0 : height }}
    >
      <div
        ref={ref}
        className={cn(
          "max-sm:duration-0 max-sm:transition-none transition-opacity duration-150 ease-out-cubic",
          searchActive ? "opacity-0" : "opacity-100",
        )}
      >
        {children}
      </div>
    </div>
  );
}
