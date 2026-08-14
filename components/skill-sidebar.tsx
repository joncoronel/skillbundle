"use client";

import type { ReactNode } from "react";
import type { IconSvgElement } from "@hugeicons/react";
import { SkillRecord } from "@/components/skill-record";
import {
  SkillSectionNav,
  type SectionNavItem,
} from "@/components/skill-section-nav";
import type { SkillAuditEntry } from "@/components/skill-audit-section";
import type { SkillInsights } from "@/components/skill-chart-shared";
import { useEnteredSection } from "@/hooks/use-entered-section";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

/** Tailwind's `lg`, where this column becomes a sticky sidebar. */
const DESKTOP = "(min-width: 64rem)";

/**
 * The skill page's one sidebar column, and the piece that decides what it is
 * holding.
 *
 * The page has two phases. While the reader is deciding — masthead through
 * History — the record earns the column and the outline is worth nothing,
 * because they have not entered the document. Once they are reading, that
 * reverses: the outline is the only thing that helps, and an install count is
 * answering a question already settled. The action alone spans both.
 *
 * So this is ONE sticky container with a card that folds to just its action at
 * the document boundary, and a rail that takes the height the fold releases.
 * The alternative — two permanent columns, one each — is what this replaced,
 * and it could not fit: 435px of card plus 695px of rail needs 1130px in the
 * ~800px a 900px viewport leaves under the header, so the rail grew its own
 * scrollbar and the page had to widen to 92rem to afford the second column at
 * all. Folded, the same pair needs 751px and fits.
 *
 * `max-h` + `flex` is what makes the handoff free: the rail is the flex child
 * with `min-h-0`, so it simply takes whatever the card is not using. Nothing
 * measures anything.
 */
export function SkillSidebar({
  navItems,
  action,
  className,
  ...record
}: {
  navItems: SectionNavItem[];
  action: ReactNode;
  className?: string;
  source: string;
  skillId: string;
  externalUrl: string;
  externalIcon: IconSvgElement;
  externalLabel: string;
  curatedOwner?: string;
  insights: SkillInsights;
  updatedKind: string;
  updatedDate: string;
  audits: SkillAuditEntry[] | null;
  stars: number | null;
}) {
  // Gated on the breakpoint rather than left to a `max-lg:` class override,
  // because the fold is not only paint: it sets `inert` and takes the record
  // out of the tab order. Below `lg` this column is a normal block in the flow
  // with the document under it, nothing is sticky, and a card that folded as
  // you scrolled past it would be hiding content for no reason at all.
  //
  // `useMediaQuery` starts false, so the first paint is always the full record.
  // That is the right way round: an unfolded card that folds is a state change
  // the reader sees happen, while a folded one that opens looks like content
  // arriving late.
  const isDesktop = useMediaQuery(DESKTOP);
  const collapsed = useEnteredSection("documentation", isDesktop);

  return (
    <aside className={className}>
      <div className="lg:sticky lg:top-24 lg:z-30 lg:flex lg:max-h-[calc(100dvh-7rem)] lg:flex-col">
        <SkillRecord {...record} action={action} collapsed={collapsed} />
        <SkillSectionNav items={navItems} className="mt-6" />
      </div>
    </aside>
  );
}

/**
 * The sidebar's shape while the body loads. Kept beside the real thing so the
 * two cannot drift — the page's skeleton draws the card, this draws the column
 * it sits in.
 */
export function SkillSidebarShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(className)}>
      <div className="lg:sticky lg:top-24 lg:z-30">{children}</div>
    </div>
  );
}
