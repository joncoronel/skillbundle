"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * The skill page's tab strip: Overview, History, Stats, Security. Each tab is a
 * ROUTE (`/{source}/{skillId}`, `.../history`, `.../stats`, `.../security`),
 * not client tab state — every tab keeps its own URL, static shell, and
 * metadata, and the layout above this strip persists across the navigation so
 * switching tabs never re-renders the masthead.
 *
 * Two inputs, and neither is URL data read on the client:
 *
 *   - `base` (the skill's own path) comes from the server, from the masthead
 *     that already awaits `params` inside the layout's Suspense boundary.
 *   - the active tab is `useSelectedLayoutSegment()`, the child segment the
 *     router has mounted under the skill layout — `null` on the Overview
 *     page, `"history"` / `"stats"` / `"security"` on a tab.
 *
 * It used to read `usePathname()` and derive both from it, which kept the strip
 * params-free and in the shared App Shell — and tripped Next's instant
 * validation in dev: a pathname is only known at runtime, so a Client
 * Component reading it outside `<Suspense>` is a blocking route. The strip now
 * renders WITH the masthead and its skeleton draws the four labels as static
 * text, so the shell keeps the same structure either way.
 *
 * Styled after the cubby-ui underline Tabs (hairline divider, 3px rounded
 * indicator) but hand-rolled over Links: Base UI's Tabs own their active state,
 * and here the router owns it.
 */
export const SKILL_TABS = [
  { slug: "", label: "Overview" },
  { slug: "history", label: "History" },
  { slug: "stats", label: "Stats" },
  { slug: "security", label: "Security" },
] as const;

export function SkillTabs({
  base,
  className,
}: {
  /** The skill's own path (`skillHref(source, skillId)`). */
  base: string;
  className?: string;
}) {
  const segment = useSelectedLayoutSegment();
  const active = SKILL_TABS.some((t) => t.slug === segment) ? segment : "";

  return (
    <SkillTabsFrame className={className}>
      {SKILL_TABS.map((tab) => {
        const isActive = tab.slug === active;
        return (
          <Link
            key={tab.slug}
            href={tab.slug ? `${base}/${tab.slug}` : base}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              TAB_CLASS,
              isActive
                ? "text-foreground after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.75 after:rounded-full after:bg-neutral"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </SkillTabsFrame>
  );
}

const TAB_CLASS =
  "relative rounded-sm px-2.5 py-2 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/50";

/**
 * The strip's chrome — the divider and the row — shared with the skeleton so
 * the two cannot drift.
 */
export function SkillTabsFrame({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <nav
      aria-label="Skill sections"
      className={cn("border-b border-border", className)}
    >
      {/* -mb-px drops the active indicator onto the divider so the two read as
          one line, the way an underline tab always sits. */}
      <div className="-mb-px flex gap-1 overflow-x-auto">{children}</div>
    </nav>
  );
}

/**
 * The strip as the masthead skeleton draws it: the same four labels in the
 * same boxes, as plain text rather than links, none active. Real text, because
 * none of it depends on the skill — only the hrefs do, and those arrive with
 * the masthead.
 */
export function SkillTabsSkeleton({ className }: { className?: string }) {
  return (
    <SkillTabsFrame className={className}>
      {SKILL_TABS.map((tab) => (
        <span key={tab.slug} className={cn(TAB_CLASS, "text-muted-foreground")}>
          {tab.label}
        </span>
      ))}
    </SkillTabsFrame>
  );
}
