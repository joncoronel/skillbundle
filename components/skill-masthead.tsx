import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { SkillTabs, SkillTabsSkeleton } from "@/components/skill-tabs";

/**
 * The skill page's masthead: breadcrumb, the h1, and the tab strip. Rendered by
 * the skill LAYOUTS (both route trees), inside a Suspense boundary, so it
 * paints once and survives every tab navigation underneath it.
 *
 * The breadcrumb arrives as a slot because the two skill routes build different
 * trails (org/repo vs. /site/source) — same split the old per-page version had.
 * The tab strip lives here rather than beside this in the layout because its
 * hrefs need the skill's path, which is `params`, which is what this boundary
 * exists to await; see skill-tabs.tsx for why it cannot read the URL itself.
 */
export function SkillMasthead({
  skillId,
  base,
  breadcrumb,
}: {
  skillId: string;
  /** The skill's own path (`skillHref(source, skillId)`), for the tab hrefs. */
  base: string;
  breadcrumb: ReactNode;
}) {
  return (
    <div>
      {breadcrumb}

      {/* Deliberately NOT the display role. Skill ids are long, lowercase,
          hyphenated machine identifiers, and `text-display-sm` would wrap a
          30-character id across three lines on a phone. This heading is sized
          to the content it carries, not to its position on the page.

          `id`/`tabIndex` make the masthead the Overview tab's section-nav
          first target; the anchor lives up here in the layout so it resolves
          on first paint, before the tab body streams in. */}
      <h1
        id="overview"
        tabIndex={-1}
        className="min-w-0 scroll-mt-24 text-3xl font-semibold tracking-tight outline-none sm:text-4xl"
      >
        {skillId}
      </h1>

      <SkillTabs base={base} className="mt-6" />
    </div>
  );
}

/**
 * The masthead's Suspense fallback. Breadcrumb and h1 are URL data, so on a
 * client navigation into a skill this is what the shared App Shell paints
 * where the trail and title will land — the same two bars the old route-level
 * `SkillDetailPageLoading` drew. The tab strip's labels are NOT URL data, so
 * they render as real text in the same boxes the links will occupy.
 */
export function SkillMastheadSkeleton() {
  return (
    <div>
      <div className="mb-6">
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <Skeleton className="h-9 w-1/2 max-w-md sm:h-10" />
      <SkillTabsSkeleton className="mt-6" />
    </div>
  );
}
