"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import {
  Drawer,
  DrawerContent,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
  DrawerBody,
} from "@/components/ui/cubby-ui/drawer/drawer";
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
 * Distance from the top of the viewport at which a heading counts as "current".
 * The sticky app header is 56px; the rest is the margin that keeps the item
 * from flipping the instant a heading grazes the header's lower edge.
 */
const ACTIVE_OFFSET = 96;

/**
 * Marker geometry. Every marker is right-aligned inside a fixed 28px track, so
 * the label column starts at the same x for every level and nothing shifts when
 * a marker grows. Depth reads from the marker's LENGTH — the shorter the tick,
 * the deeper the heading — and the label picks up a matching indent so the
 * nesting survives for anyone who isn't reading 2px differences in a hairline.
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
 * The skill page's wayfinding, in two forms driven by one item list.
 *
 * Desktop gets a sticky line rail in the left column. Its real job is not
 * shortcuts — it's evidence: seeing "Overview / History / Documentation" with
 * the file's own headings visibly nested one level under Documentation is what
 * tells a first-time reader that the page has parts and that only the last one
 * is the file. The scroll spy then keeps answering "where am I" as they read.
 *
 * Below `lg` the rail becomes a sticky bar naming the current section, which
 * opens the same list in a drawer. A 20,000px document needs that affordance
 * more on a phone, not less.
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
  const [drawerOpen, setDrawerOpen] = useState(false);

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
      setDrawerOpen(false);
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

  const activeTitle =
    items.find((item) => item.id === activeId)?.title ?? items[0].title;

  return (
    <>
      {/* Desktop rail.
          `sticky` goes on THIS element, not on an inner wrapper. A sticky box
          travels inside its containing block, and an inner wrapper's containing
          block would be this div — whose height is exactly the nav's, leaving
          zero distance to travel and a rail that scrolls away like static
          content. Sticking the outer element instead makes the containing block
          the sidebar column, which spans the whole page. */}
      <div className={cn("hidden lg:sticky lg:top-20 lg:block", className)}>
        <div>
          <p className="mb-4 text-xs font-medium text-muted-foreground">
            On this page
          </p>
          <div
            ref={railRef}
            className="max-h-[calc(100dvh-11rem)] overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <nav aria-label="Sections of this page">
              <ul className="space-y-px">
                {items.map((item) => {
                  const active = item.id === activeId;
                  return (
                    <li key={item.id}>
                      <a
                        ref={active ? activeItemRef : undefined}
                        href={`#${item.id}`}
                        aria-current={active ? "true" : undefined}
                        onClick={(event) => goTo(event, item.id)}
                        className="group flex items-start gap-3 rounded-sm py-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50"
                      >
                        {/* `items-start` + this offset put the marker on the
                            first line's optical centre, so a title that wraps
                            to two lines still reads as one entry rather than
                            leaving the tick floating between them. */}
                        <span
                          aria-hidden="true"
                          className="mt-[0.5625rem] flex shrink-0 justify-end"
                          style={{ width: TRACK }}
                        >
                          {/* 2px and pill-capped rather than a hairline. At
                              1px the marks read as rules — the same vocabulary
                              as every divider on the page — and the shortest
                              ones nearly vanished in dark mode. With rounded
                              ends they read as marks in a scale instead, which
                              is what they are. Their colour ramps in three
                              steps (rest → hover → current) off `foreground`,
                              so it inverts with the theme for free. */}
                          <motion.span
                            className={cn(
                              "block h-0.5 rounded-full transition-colors duration-100 ease-out",
                              active
                                ? "bg-foreground"
                                : "bg-foreground/25 group-hover:bg-foreground/60",
                            )}
                            initial={false}
                            animate={{
                              width: active ? TRACK : restWidth(item.level),
                            }}
                            transition={
                              reduceMotion
                                ? { duration: 0 }
                                : {
                                    type: "spring",
                                    stiffness: 320,
                                    damping: 28,
                                  }
                            }
                          />
                        </span>
                        {/* Wraps to two lines rather than truncating. A table
                            of contents whose entries end in an ellipsis is
                            worse than one that takes an extra line: the reader
                            has to click to find out where a link goes, which is
                            the one thing the rail exists to prevent. */}
                        <span
                          className={cn(
                            "line-clamp-2 text-sm leading-snug transition-colors duration-100 ease-out",
                            LABEL_INDENT[
                              Math.min(item.level, LABEL_INDENT.length - 1)
                            ],
                            item.level === 0 ? "font-medium" : "font-normal",
                            active
                              ? "text-foreground"
                              : "text-muted-foreground group-hover:text-foreground",
                          )}
                        >
                          {item.title}
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>
        </div>
      </div>

      {/* Mobile: a sticky bar naming where you are, opening the same list. The
          top margin only shows at rest, directly under the record panel; once
          the bar pins at the header's lower edge it has no effect. */}
      <div className="sticky top-14 z-30 -mx-4 mt-6 border-b border-border bg-background/85 backdrop-blur-sm lg:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/50"
        >
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-xs text-muted-foreground">
              On this page
            </span>
            <span className="truncate text-sm font-medium text-foreground">
              {activeTitle}
            </span>
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            strokeWidth={2}
            className="size-4 shrink-0 text-muted-foreground"
          />
        </button>
      </div>

      <Drawer direction="bottom" open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent>
          <DrawerHandle />
          <DrawerHeader>
            <DrawerTitle className="text-base">On this page</DrawerTitle>
          </DrawerHeader>
          <DrawerBody className="px-2 pb-4">
            <nav aria-label="Sections of this page">
              <ul>
                {items.map((item) => {
                  const active = item.id === activeId;
                  return (
                    <li key={item.id}>
                      <a
                        href={`#${item.id}`}
                        aria-current={active ? "true" : undefined}
                        onClick={(event) => goTo(event, item.id)}
                        className={cn(
                          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                          active
                            ? "bg-surface-2 font-medium text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className="flex shrink-0 justify-end"
                          style={{ width: TRACK }}
                        >
                          <span
                            className={cn(
                              "block h-0.5 rounded-full",
                              active ? "bg-foreground" : "bg-foreground/25",
                            )}
                            style={{
                              width: active ? TRACK : restWidth(item.level),
                            }}
                          />
                        </span>
                        {/* Indent on the label, not the row: the active row
                            carries a fill, and shifting that fill by depth
                            would read as the highlight being misplaced. */}
                        <span
                          className={cn(
                            "line-clamp-2",
                            LABEL_INDENT[
                              Math.min(item.level, LABEL_INDENT.length - 1)
                            ],
                          )}
                        >
                          {item.title}
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </>
  );
}
