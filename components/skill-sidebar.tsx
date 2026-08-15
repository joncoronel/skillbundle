"use client";

import type { ComponentProps, ReactNode } from "react";
import { SkillRecord } from "@/components/skill-record";
import {
  SkillSectionNav,
  type SectionNavItem,
} from "@/components/skill-section-nav";
import { useEnteredSection } from "@/hooks/use-entered-section";
import { useMediaQuery } from "@/hooks/use-media-query";

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
} & /**
 * Everything else goes straight to the card, so it is DERIVED from the card's
 * own props rather than re-declared. The eleven were spelled out here once, and
 * nothing enforced that the two lists agreed: adding an optional prop to
 * `SkillRecord` would have type-checked while silently never being forwarded.
 *
 * `collapsed` and `className` are excluded because this component owns them —
 * the fold is computed here, and `className` above positions the column, not
 * the card.
 */ Omit<
  ComponentProps<typeof SkillRecord>,
  "action" | "collapsed" | "className"
>) {
  // Gated on the breakpoint rather than left to a `max-lg:` class override,
  // because the fold is not only paint: it hides the card and takes the record
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
    <SkillSidebarShell className={className}>
      <SkillRecord {...record} action={action} collapsed={collapsed} />
      <SkillSectionNav items={navItems} active={isDesktop} className="mt-6" />
    </SkillSidebarShell>
  );
}

/**
 * The sidebar column itself: the `<aside>`, the sticky box, and the height
 * budget the card and the rail share.
 *
 * Rendered by BOTH the real sidebar above and the page's loading skeleton,
 * which is the point — it shipped as a shell the skeleton alone used, and it
 * had already drifted from the container it was written to mirror, in the same
 * commit that documented it as the thing that could not drift. It was missing
 * `flex` and `max-h`, so the skeleton's column was unbounded and ran past the
 * fold on a short viewport, then snapped to a constrained one when the body
 * landed — a skeleton replaced by a different skeleton, which is exactly the
 * failure AGENTS.md warns about and nothing tests.
 *
 * `max-h` + `flex` is also what makes the card's fold free: the rail is the
 * flex child with `min-h-0`, so it simply takes whatever height the card is not
 * using, and nothing measures anything.
 */
export function SkillSidebarShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <aside className={className}>
      <div className="lg:sticky lg:top-24 lg:z-30 lg:flex lg:max-h-[calc(100dvh-7rem)] lg:flex-col">
        {children}
      </div>
    </aside>
  );
}
