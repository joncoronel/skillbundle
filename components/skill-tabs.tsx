"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/cubby-ui/tabs";
import { cn } from "@/lib/utils";

/**
 * The skill page's tab strip: Overview, History, Stats, Security. Each tab is a
 * ROUTE (`/{source}/{skillId}`, `.../history`, `.../stats`, `.../security`),
 * not client tab state — every tab keeps its own URL, static shell, and
 * metadata, and the layout above this strip persists across the navigation so
 * switching tabs never re-renders the masthead.
 *
 * Built on the cubby-ui Tabs (Base UI) for its sliding underline indicator,
 * with two deliberate departures from the usual composition:
 *
 *   - Each trigger renders as a `<Link>` (`nativeButton={false}`), so a click
 *     is a real navigation the router prefetches. `value` is controlled by
 *     `useSelectedLayoutSegment()` — the child segment mounted under the skill
 *     layout, `null` on Overview — so the indicator slides when the ROUTE
 *     changes, not when Base UI thinks a tab was picked. `activateOnFocus` is
 *     off for the same reason: arrow keys move focus between the links, Enter
 *     follows one, and Base UI never activates a tab the router hasn't.
 *   - There are no `TabsPanels`, and no entrance on the content. The panel is
 *     whatever page the router renders below, arriving through its own
 *     `loading.tsx`; a fade on top of that was tried and cut.
 *
 * Neither input is URL data read on the client: `base` comes from the server
 * (the masthead that awaits `params` inside the layout's Suspense boundary),
 * and the selected segment is router tree state. It used to read
 * `usePathname()`, which tripped Next's instant validation in dev — a pathname
 * is only known at runtime, so a Client Component reading it outside
 * `<Suspense>` is a blocking route.
 */
const SKILL_TABS = [
  { slug: "", label: "Overview" },
  { slug: "history", label: "History" },
  { slug: "stats", label: "Stats" },
  { slug: "security", label: "Security" },
] as const;

/**
 * Appended for skills that have aliases or forks, never filtered back out.
 * It lived inside `SKILL_TABS` and was removed again in two places, so the
 * constant did not mean "the tabs" and a reader had to check both filters to
 * know what renders.
 *
 * History, Stats and Security are dimensions every skill has, possibly empty.
 * Copies is a condition most skills do not meet, so a permanent tab reading
 * "published in one place" across the catalog would be chrome, and the tab
 * appearing is itself information.
 */
const COPIES_TAB = { slug: "copies", label: "Copies" } as const;

const ALL_TABS = [...SKILL_TABS, COPIES_TAB];

type SkillTabSlug = (typeof ALL_TABS)[number]["slug"];

/** The active tab for a selected layout segment: a known slug, else Overview. */
function activeSkillTab(segment: string | null): SkillTabSlug {
  return ALL_TABS.find((t) => t.slug === segment)?.slug ?? "";
}

export function SkillTabs({
  base,
  hasCopies,
  className,
}: {
  /** The skill's own path (`skillHref(source, skillId)`). */
  base: string;
  /** Whether this skill has aliases or forks, which adds the Copies tab. */
  hasCopies: boolean;
  className?: string;
}) {
  const active = activeSkillTab(useSelectedLayoutSegment());
  const tabs = hasCopies ? ALL_TABS : SKILL_TABS;

  return (
    <SkillTabsFrame className={className}>
      <Tabs value={active}>
        <TabsList
          variant="underline"
          activateOnFocus={false}
          // The frame draws the divider as a full-width hairline; the list's
          // own two-pixel divider would double it. `-mb-px` sits the sliding
          // indicator on the frame's line.
          className="-mb-px [&_[data-slot=tabs-divider]]:hidden"
          aria-label="Skill sections"
        >
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.slug}
              value={tab.slug}
              nativeButton={false}
              render={<Link href={tab.slug ? `${base}/${tab.slug}` : base} />}
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </SkillTabsFrame>
  );
}

/**
 * The strip's chrome — the full-width hairline the tabs sit on — shared with
 * the skeleton so the two cannot drift.
 */
function SkillTabsFrame({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("border-b border-border", className)}>{children}</div>
  );
}

/**
 * The strip as the masthead skeleton draws it: the same four labels in the
 * same boxes as plain text rather than links, none active. Real text, because
 * none of it depends on the skill — only the hrefs do, and those arrive with
 * the masthead. Box metrics mirror the medium underline trigger.
 */
export function SkillTabsSkeleton({ className }: { className?: string }) {
  return (
    <SkillTabsFrame className={className}>
      {/* The four tabs every skill has. Copies depends on the skill, so the
          skeleton cannot know about it and does not reserve a box for it. */}
      <div className="flex gap-x-1 pb-1">
        {SKILL_TABS.map((tab) => (
          <span
            key={tab.slug}
            className="px-2.5 py-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground"
          >
            {tab.label}
          </span>
        ))}
      </div>
    </SkillTabsFrame>
  );
}
