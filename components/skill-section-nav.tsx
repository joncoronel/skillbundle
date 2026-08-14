"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { SECTION_OFFSET } from "@/hooks/use-entered-section";
import { cn } from "@/lib/utils";

export type SectionNavItem = {
  id: string;
  title: string;
  /**
   * 0 for a section of the page itself (Overview, History, Documentation).
   * 1+ for a heading inside the SKILL.md, nested under Documentation.
   */
  level: number;
};

/**
 * Where a heading counts as "current". Shared with the record card's fold so
 * both read the page at the same line — see hooks/use-entered-section.ts.
 */
const ACTIVE_OFFSET = SECTION_OFFSET;

/**
 * Marker geometry. Every marker starts at the same x inside a fixed 28px track
 * and grows rightward; the label column also starts at the same x for every
 * level, so nothing shifts when a marker animates. Depth reads from the
 * marker's LENGTH — the shorter the mark, the deeper the heading — and the
 * label picks up a matching indent so the nesting survives for anyone not
 * measuring 18px differences in a 2px bar.
 *
 * Flush LEFT, not right, and that is the whole reason this rail sits on the
 * trailing side of the page. The flush edge is the one that faces the document;
 * everything that varies — mark length, label indent, line endings — runs away
 * from the text into the outer margin. Mirror this (right-align the marks) only
 * if the rail ever moves back to the leading side, and move it back only if
 * you want a ragged edge against the content again.
 */
const TRACK = 28;
const REST_WIDTH = [28, 16, 10] as const;
const LABEL_INDENT = ["", "pl-3", "pl-6"] as const;

function restWidth(level: number) {
  return REST_WIDTH[Math.min(level, REST_WIDTH.length - 1)];
}

/**
 * Which section the reader is currently in.
 *
 * Scroll position, not IntersectionObserver. An observer answers "is this
 * element on screen", which is the wrong question for a table of contents: a
 * 4,000px section is never fully on screen, several headings are on screen at
 * once, and a fast scroll can skip an entry's callback entirely. Reading
 * `getBoundingClientRect().top` for each target and taking the last one above
 * the header answers the right question directly, and it's cheap — the loop
 * short-circuits at the first heading below the fold, and only runs inside a
 * rAF the scroll handler schedules.
 */
function useActiveSection(ids: string[]) {
  const [activeId, setActiveId] = useState<string | null>(ids[0] ?? null);

  useEffect(() => {
    if (ids.length === 0) return;

    let frame = 0;

    const measure = () => {
      frame = 0;

      // At the very bottom, the last section is current even though its heading
      // is far above the fold — otherwise the final entry can never light up on
      // a page whose last section is shorter than the viewport.
      const reachedBottom =
        window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 2;
      if (reachedBottom) {
        setActiveId(ids[ids.length - 1]);
        return;
      }

      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top > ACTIVE_OFFSET) break;
        current = id;
      }
      setActiveId(current);
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [ids]);

  return activeId;
}

/**
 * Group the flat outline into branches: every item at level 0 or 1 is a row,
 * and anything deeper hangs off the nearest level-1 row above it.
 *
 * That split is the whole progressive-depth rule. Levels 0 and 1 are the page's
 * shape — our sections, plus the file's own top-level headings — and they are
 * always worth showing. Level 2 and below are the shape of ONE of those
 * sections, and are worth showing only while the reader is inside it.
 */
type NavBranch = { item: SectionNavItem; children: SectionNavItem[] };

function toBranches(items: SectionNavItem[]): NavBranch[] {
  const branches: NavBranch[] = [];
  for (const item of items) {
    if (item.level <= 1 || branches.length === 0) {
      branches.push({ item, children: [] });
    } else {
      branches[branches.length - 1].children.push(item);
    }
  }
  return branches;
}

/**
 * The skill page's wayfinding: a line rail in the sidebar column, from `lg` up.
 *
 * Its real job is not shortcuts — it's evidence. Seeing "Overview / History /
 * Documentation" with the file's own headings visibly nested one level under
 * Documentation is what tells a first-time reader that the page has parts and
 * that only the last one is the file. The scroll spy then keeps answering
 * "where am I" as they read.
 *
 * ── Progressive depth ─────────────────────────────────────────────────────
 *
 * Every heading at once was 695px of rail for a 17-heading skill — most of a
 * viewport spent on a list, and long enough that the rail needed its own inner
 * scrollbar to fit beside anything. Showing levels 0 and 1 always, and a
 * branch's deeper headings only while the reader is inside that branch, holds
 * a typical skill near 300px while never hiding a destination the reader is
 * actually near. The cost is honest: a heading three levels down is one scroll
 * or one parent-click away instead of always listed.
 *
 * ── Where it lives ────────────────────────────────────────────────────────
 *
 * NOT sticky itself, and it does not own a column. It is the lower half of the
 * sidebar's one sticky container, under the record card, and it takes whatever
 * height the card is not using — which is why the card's fold hands it real
 * space rather than leaving a gap. See skill-detail-page.tsx for the flex
 * arrangement that does that.
 *
 * It still renders on wide screens only. This rail is pure navigation: every
 * destination is reachable by scrolling and every fact it points at is on the
 * page, so dropping it costs convenience and nothing else. Below `lg` that
 * convenience is worth less than the width it would take from a code-bearing
 * document. There used to be a phone version — a sticky bar plus a drawer —
 * and it was a second navigation system, with its own scroll-spy readout and
 * its own list, built to serve the surface with the least room to spare.
 */
export function SkillSectionNav({
  items,
  className,
}: {
  items: SectionNavItem[];
  className?: string;
}) {
  const ids = useMemo(() => items.map((item) => item.id), [items]);
  const activeId = useActiveSection(ids);
  const reduceMotion = useReducedMotion();
  const branches = useMemo(() => toBranches(items), [items]);

  const railRef = useRef<HTMLDivElement | null>(null);
  const activeItemRef = useRef<HTMLAnchorElement | null>(null);

  // Keep the active entry visible when the rail is long enough to scroll. Scoped
  // to the rail's own scroll container so the page never moves with it.
  useEffect(() => {
    const rail = railRef.current;
    const item = activeItemRef.current;
    if (!rail || !item) return;
    if (rail.scrollHeight <= rail.clientHeight) return;

    const railBox = rail.getBoundingClientRect();
    const itemBox = item.getBoundingClientRect();
    if (itemBox.top >= railBox.top && itemBox.bottom <= railBox.bottom) return;

    rail.scrollTo({
      top:
        rail.scrollTop +
        (itemBox.top - railBox.top) -
        rail.clientHeight / 2 +
        itemBox.height / 2,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [activeId, reduceMotion]);

  const goTo = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
      // Let modified clicks (new tab, new window) behave normally.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const el = document.getElementById(id);
      if (!el) return;
      event.preventDefault();
      history.pushState(null, "", `#${id}`);

      // Smooth only for a short hop. A SKILL.md runs to 20,000px, and animating
      // a jump that long is not a nicety — it takes seconds, blurs everything
      // on the way past, and leaves the reader watching a page scroll instead
      // of reading the section they asked for. Past a couple of screens the
      // honest answer is to be there already.
      const distance = Math.abs(el.getBoundingClientRect().top);
      const smooth = !reduceMotion && distance < window.innerHeight * 2.5;
      el.scrollIntoView({
        behavior: smooth ? "smooth" : "auto",
        block: "start",
      });
      // Every target carries tabIndex={-1}, so this moves the keyboard position
      // and the screen-reader cursor with the jump instead of leaving both back
      // at the link.
      el.focus({ preventScroll: true });
    },
    [reduceMotion],
  );

  if (items.length === 0) return null;

  // Two nested elements, and which one is sticky is not interchangeable. The
  // outer div is the GRID ITEM: it spans both content rows and stretches to the
  // row height, so it is the travel space. The inner div is the sticky one,
  // because a sticky box only pins its own border box — put `sticky` on the
  // stretched outer element and its box already covers the whole page, so
  // nothing ever appears to pin and the rail scrolls away like static content.
  return (
    // `flex min-h-0` so the label stays put and the list below it is the part
    // that scrolls. The height this gets is whatever the sticky container has
    // left after the card, so a folded card is felt here as more rail rather
    // than as empty space.
    <div className={cn("hidden lg:flex lg:min-h-0 lg:flex-col", className)}>
      <p className="mb-4 shrink-0 text-xs font-medium text-muted-foreground">
        On this page
      </p>
      <div
        ref={railRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <nav aria-label="Sections of this page">
          <ul className="space-y-px">
            {branches.map((branch) => {
              const open =
                branch.item.id === activeId ||
                branch.children.some((child) => child.id === activeId);
              return (
                <li key={branch.item.id}>
                  <NavEntry
                    item={branch.item}
                    active={branch.item.id === activeId}
                    innerRef={
                      branch.item.id === activeId ? activeItemRef : undefined
                    }
                    onNavigate={goTo}
                    reduceMotion={!!reduceMotion}
                  />
                  {branch.children.length > 0 && (
                    // The same 0fr → 1fr collapse the card and the header menu
                    // use, so a branch opening reads as part of one vocabulary
                    // rather than as a third kind of expand. `inert` while
                    // closed keeps the clipped links out of the tab order.
                    <div
                      className={cn(
                        "grid transition-[grid-template-rows] duration-400 ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none",
                        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                      )}
                    >
                      <div className="min-h-0 overflow-hidden" inert={!open}>
                        <ul className="space-y-px">
                          {branch.children.map((child) => (
                            <li key={child.id}>
                              <NavEntry
                                item={child}
                                active={child.id === activeId}
                                innerRef={
                                  child.id === activeId
                                    ? activeItemRef
                                    : undefined
                                }
                                onNavigate={goTo}
                                reduceMotion={!!reduceMotion}
                              />
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}

function NavEntry({
  item,
  active,
  innerRef,
  onNavigate,
  reduceMotion,
}: {
  item: SectionNavItem;
  active: boolean;
  innerRef?: React.Ref<HTMLAnchorElement>;
  onNavigate: (event: React.MouseEvent<HTMLAnchorElement>, id: string) => void;
  reduceMotion: boolean;
}) {
  return (
    <a
      ref={innerRef}
      href={`#${item.id}`}
      aria-current={active ? "true" : undefined}
      onClick={(event) => onNavigate(event, item.id)}
      className="group flex items-start gap-3 rounded-sm py-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50"
    >
      {/* `items-start` + this offset put the marker on the first line's optical
          centre, so a title that wraps to two lines still reads as one entry
          rather than leaving the tick floating between them. */}
      <span
        aria-hidden="true"
        className="mt-[0.5625rem] flex shrink-0 justify-start"
        style={{ width: TRACK }}
      >
        {/* 2px and pill-capped rather than a hairline. At 1px the marks read as
            rules — the same vocabulary as every divider on the page — and the
            shortest ones nearly vanished in dark mode. With rounded ends they
            read as marks in a scale instead, which is what they are. Their
            colour ramps in three steps (rest → hover → current) off
            `foreground`, so it inverts with the theme for free. */}
        <motion.span
          className={cn(
            "block h-0.5 rounded-full transition-colors duration-100 ease-out",
            active
              ? "bg-foreground"
              : "bg-foreground/25 group-hover:bg-foreground/60",
          )}
          initial={false}
          animate={{ width: active ? TRACK : restWidth(item.level) }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { type: "spring", stiffness: 320, damping: 28 }
          }
        />
      </span>
      {/* Wraps to two lines rather than truncating. A table of contents whose
          entries end in an ellipsis is worse than one that takes an extra line:
          the reader has to click to find out where a link goes, which is the
          one thing the rail exists to prevent. */}
      <span
        className={cn(
          "line-clamp-2 text-sm leading-snug transition-colors duration-100 ease-out",
          LABEL_INDENT[Math.min(item.level, LABEL_INDENT.length - 1)],
          item.level === 0 ? "font-medium" : "font-normal",
          active
            ? "text-foreground"
            : "text-muted-foreground group-hover:text-foreground",
        )}
      >
        {item.title}
      </span>
    </a>
  );
}
