"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useReducedMotion } from "motion/react";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { SECTION_OFFSET } from "@/hooks/use-entered-section";
import { cn } from "@/lib/utils";

export type SectionNavItem = {
  id: string;
  title: string;
  /**
   * 0 for a section of the page itself (Overview, Documentation).
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
 * The rail's geometry, in px, all measured from the nav's own left edge.
 *
 * One spine at x=0 that every row hangs off, and — for the one branch that is
 * open — a second trunk dropping under the parent, elbowing out to each child.
 * The SVG paths and the rows' padding both come from these numbers, so the
 * drawn lines and the DOM they point at cannot drift apart.
 *
 * Flush LEFT, not right, and that is still the whole reason this rail sits on
 * the trailing side of the page (see skill-detail-page.tsx). The spine is the
 * edge that faces the document; every ragged thing — the indents, the branch
 * ends, the line endings — runs away from the text into the outer margin.
 * Mirror the tree only if the rail ever moves back to the leading side.
 *
 * ── The three numbers that decide whether this looks like a tree ───────────
 *
 * An elbow is an arc plus a STRAIGHT ARM, and the arm is what makes it read as
 * a branch. The first pass gave the arc 9 of an 11.5px horizontal run and left
 * 2.5px of arm, so the arc was effectively the whole shape and each branch
 * came out a little hook that stopped as soon as it had turned. An arm roughly
 * as long as the gap to the label reads as a corner and a reach.
 *
 * The child indent is the other half of it. 20px was enough to be legible and
 * not enough to be a level: the children sat almost under their parent with a
 * drawn tree crammed into the gap. At 34 the tree has room to be a shape, and
 * the nesting is visible before you have read a word.
 *
 * Both came from measuring the reference these were modelled on, which works
 * out to trunk +14 / arm 8 / indent +40 from its head's text. Ours are a shade
 * tighter because this rail is a 272px sidebar carrying real heading text, not
 * a demo with one-word labels, and the label still needs ~208px to wrap twice
 * rather than three times.
 */
const ROW_X = 18; // A page section's label (level 0)
const SUB_X = 30; // A file heading's label (level 1)
const ELBOW_R = 10;
const ELBOW_END = 56; // Arc ends at 48, so 8px of straight arm
const CHILD_X = 64; // A nested heading's label (level 2), 8px past the arm

/**
 * The branch trunk, dropping under the parent's label.
 *
 * A whole number, and that follows from the stroke being 2px: a stroke is
 * centred on its coordinate, so an even width wants an integer (29–31 → two
 * clean pixels) and an odd or fractional one wants a .5. This was 38.5 while
 * the stroke was 1.5. Change one and you have to change the other, or the line
 * goes soft — see STROKE below for why it is 2.
 */
const TRUNK_X = SUB_X + 8;

/**
 * 2px rather than the reference's 1.5, and this is a taste call, not a fix.
 *
 * What actually made the tips look chopped was the SVG viewport clipping the
 * caps (see the `width` on the svg below); that bug was independent of the
 * width and is fixed there. The width is the follow-on judgement: a round cap
 * is half the stroke, so 1.5 leaves a 0.75px dome — real, but under a pixel,
 * which at 1x antialiases to something barely distinguishable from a flat end.
 * At 2px the cap is a whole pixel and the roundness survives on any display,
 * not just the 2x screens the reference is usually admired on.
 *
 * Drop it back to 1.5 if the tree ever reads too heavy; the caps will still be
 * round, just quieter. Keep the coordinates in step if you do — TRUNK_X needs
 * the .5 back.
 */
const STROKE = 2;

/**
 * A row's vertical metrics, and they live up here with the horizontal ones
 * because the SVG has to agree with them.
 *
 * Everything the rail draws lands on a row's FIRST LINE, not on its middle. An
 * entry that wraps to two lines is ordinary at this width, and a mark or an
 * elbow on the row's centre lands in the gap between its lines — a line
 * pointing at nothing, beside an entry that has stopped reading as one entry.
 * Half a line below the padding is where the eye starts the title, whether the
 * title takes one line or three.
 *
 * Applied as inline style rather than `py-1.5 leading-snug`, so the number the
 * elbows are positioned from is the same number the rows are laid out with. As
 * classes they were two independent declarations that happened to agree.
 */
const ROW_PAD_Y = 6;
const LINE_H = 19.25; // text-sm at leading-snug
const FIRST_LINE_Y = ROW_PAD_Y + LINE_H / 2;

/**
 * The corner and the arm that reach one row, starting on the trunk.
 *
 * The sweep is counter-clockwise so the corner bulges down and left, the way a
 * file tree draws it. Both layers are built from this one function, so the line
 * that lights up traces exactly the line that was already there, which is the
 * whole trick.
 */
function elbowAt(y: number) {
  return `M ${TRUNK_X} ${y - ELBOW_R} A ${ELBOW_R} ${ELBOW_R} 0 0 0 ${TRUNK_X + ELBOW_R} ${y} H ${ELBOW_END}`;
}

/** The accent layer's copy, authored at y=0 because it is moved by transform. */
const ELBOW = elbowAt(0);

/**
 * The whole grey tree as ONE path, and it has to be one path.
 *
 * Every elbow starts tangent to the trunk, so the top of its arc runs along the
 * same pixels the trunk already covers. As separate elements at 25% alpha those
 * two strokes composite, and each junction shows up as a dark blot on an
 * otherwise even line — the overlap reading as structure that isn't there. A
 * single path is stroked once, so its own subpaths cannot stack on each other
 * however much they overlap.
 *
 * The accent layer is exempt: it is fully opaque, so where its trunk and elbow
 * cross there is nothing to see, and it stays two elements because they move
 * independently.
 */
function treePath(centers: number[], last: number) {
  return [`M ${TRUNK_X} 0 V ${last - ELBOW_R}`, ...centers.map(elbowAt)].join(
    " ",
  );
}

/**
 * SVG transforms resolve against the user-space origin rather than the
 * element's own box, which is what makes a `scaleY` off y=0 mean "this many
 * user units long" and a `translateY` mean "move to this row".
 */
const SVG_ORIGIN = {
  transformBox: "view-box",
  transformOrigin: "0 0",
} as const;

/**
 * The one curve in the rail that carries travel. Matches the collapse used by
 * the record card and the header menu, so the branch opening and the line
 * moving inside it are the same gesture.
 */
const GLIDE =
  "transition-transform duration-200 ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none";

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
 *
 * `enabled` is what keeps "cheap" true below `lg`, where the rail is
 * `display: none` and nothing it computes can be seen. Without it every scroll
 * frame on a phone ran a layout-read loop over up to 52 ids and re-rendered
 * into a hidden subtree — the highest-traffic route paying its largest scroll
 * cost on the weakest devices, for nothing. The sibling `useEnteredSection`
 * took the same argument for the same reason.
 */
function useActiveSection(ids: string[], enabled: boolean) {
  const [activeId, setActiveId] = useState<string | null>(ids[0] ?? null);

  useEffect(() => {
    if (!enabled || ids.length === 0) return;

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
  }, [ids, enabled]);

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
    const owner = branches[branches.length - 1];
    // A level-0 row is one of OUR page sections and never owns children: it has
    // no deeper headings of its own, and the handoff below opens the branch it
    // introduces rather than a branch of its own.
    //
    // Without that guard a deeper-first outline broke silently. `normalizeOutline`
    // rebases so the shallowest heading is level 1, so a SKILL.md that opens
    // `## Setup` and only later reaches `# Reference` produces an outline whose
    // FIRST items are level 2. Those attached themselves to the `documentation`
    // level-0 row, and the handoff then opened the next branch instead — leaving
    // the reader scrolling through sections with nothing lit in the rail and the
    // active link inside a hidden, zero-height container.
    if (item.level <= 1 || !owner || owner.item.level < 1) {
      branches.push({ item, children: [] });
    } else {
      owner.children.push(item);
    }
  }
  return branches;
}

/**
 * The skill page's wayfinding: a branching line rail in the sidebar column,
 * from `lg` up.
 *
 * Its real job is not shortcuts — it's evidence. Seeing "Overview /
 * Documentation" with the file's own headings visibly hanging under
 * Documentation is what tells a first-time reader that the page has parts and
 * that only the last one is the file. The scroll spy then keeps answering
 * "where am I" as they read.
 *
 * ── Why a tree, and not a column of ticks ─────────────────────────────────
 *
 * The rail this replaced encoded depth in the LENGTH of a 2px mark — 28px,
 * then 16px, then 10px. It worked, but it asked the reader to measure 6px
 * differences in a thin bar to learn the page's shape, and it had nothing at
 * all to say about WHICH parent a nested heading belonged to. A drawn branch
 * answers both without a key: the trunk is the section, the elbow is the
 * heading, and the accent line is the route from one to the other.
 *
 * ── Two things move, and they move the same way ───────────────────────────
 *
 * The mark travels down the spine to the section you are in, and the accent
 * elbow travels down the trunk to the heading. Same 200ms, same curve, both on
 * composited transforms, so the rail reads as one mechanism tracking you
 * rather than as two widgets reacting.
 *
 * Neither of them REDRAWS. The current heading changes on scroll, several
 * times per section, and a line that re-drew itself on each change — or a mark
 * that faded out here and in there — would be an animation starting from
 * scratch in the reader's periphery all the way down a 20,000px file. A single
 * element changing position is continuous by construction: interrupt it
 * halfway and it carries on from where it is, because a CSS transition on a
 * transform is the one kind of motion that never restarts. Everything else in
 * the rail is instant or a 100ms colour fade.
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
 * space rather than leaving a gap. See skill-sidebar.tsx for the flex
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
  active,
  className,
}: {
  items: SectionNavItem[];
  /**
   * Whether this rail is the visible one. The DOM stays server-rendered at
   * every width (see the header comment) — this only gates the scroll spy, so
   * a phone does not pay for a readout it cannot see.
   */
  active: boolean;
  className?: string;
}) {
  const ids = useMemo(() => items.map((item) => item.id), [items]);
  const activeId = useActiveSection(ids, active);
  const reduceMotion = useReducedMotion();
  const branches = useMemo(() => toBranches(items), [items]);

  /**
   * Which branch is showing its deeper headings.
   *
   * The obvious rule — open the branch that owns the current heading — leaves a
   * hole, and it is visible rather than theoretical: standing on the
   * "Documentation" header, the reader is inside no document branch yet,
   * because the file's first heading is still ~80px below. For that whole
   * window the record card has already folded (it watches the same section) and
   * the rail has not opened, so the sidebar shows four entries and a button and
   * the space the fold released goes to nothing.
   *
   * A level-0 row is a page section and has no children of its own, so it hands
   * off to the branch it introduces. Being at a section's header means you are
   * about to read what is under it — which is precisely when its outline is
   * worth showing, and it makes the fold and the expansion one gesture at one
   * scroll position instead of two 80px apart.
   *
   * "Has no children of its own" is guaranteed by `toBranches`, not assumed
   * here: it refuses to attach a child to a level-0 row. If that ever changes,
   * this handoff needs a matching guard, because a level-0 row that owned
   * children would open the NEXT branch while the reader was inside its own.
   */
  const openBranchId = useMemo(() => {
    const index = branches.findIndex(
      (branch) =>
        branch.item.id === activeId ||
        branch.children.some((child) => child.id === activeId),
    );
    if (index === -1) return null;
    const owner = branches[index];
    if (owner.item.level === 0 && branches[index + 1]) {
      return branches[index + 1].item.id;
    }
    return owner.item.id;
  }, [branches, activeId]);

  /**
   * Which row the spine mark sits on.
   *
   * The head that owns the current heading, not the heading itself — a nested
   * heading's "you are here" is the branch drawn to it, and the mark's job is
   * the level above that: which section of the page you are in. The head's
   * LABEL stays muted and keeps no `aria-current`, so the current link is
   * still unambiguous.
   */
  const markedId = useMemo(
    () =>
      branches.find(
        (branch) =>
          branch.item.id === activeId ||
          branch.children.some((child) => child.id === activeId),
      )?.item.id ?? null,
    [branches, activeId],
  );

  const railRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const markerRef = useRef<HTMLSpanElement | null>(null);
  const markerBox = useRef<string | null>(null);
  const activeItemRef = useRef<HTMLAnchorElement | null>(null);

  /**
   * Move the mark to the row it belongs on.
   *
   * ONE element that travels, rather than a tick per row fading in and out.
   * The spine is a continuous line and the mark is a position ON it, so a mark
   * that jumps between rows is claiming the reader teleported; one that slides
   * says they moved down the page, which is what happened. It rides the same
   * curve as the branch elbow, so the two things the rail animates are visibly
   * one gesture.
   *
   * `glide: false` is for reflow, and the distinction matters more than it
   * looks. Opening a branch moves every row below it for 400ms, and a mark
   * that eased toward a moving target would trail its own row the whole way.
   * Snapping means it tracks the row exactly through the fold. The early
   * return is what keeps the glide alive in the ordinary case: when the marked
   * row has not actually moved, a reflow elsewhere in the rail leaves the
   * in-flight transition alone instead of cutting it short.
   */
  const placeMarker = useCallback(
    (animate: boolean) => {
      const content = contentRef.current;
      const marker = markerRef.current;
      if (!content || !marker) return;

      const row = markedId
        ? content.querySelector<HTMLElement>(
            `[data-nav-row="${CSS.escape(markedId)}"]`,
          )
        : null;
      // The row's WHOLE box, padding included, not a tick centred on its text.
      // A short mark on a tall row leaves the spine mostly unlit and reads as a
      // dot that happens to be near an entry; one that fills the row reads as
      // the row being the selected one, which is what it means. It also closes
      // the gaps — consecutive positions now meet at the 1px row seam instead
      // of leaving 17px of dead track between them.
      //
      // `offsetHeight`, so a heading that wraps gets a mark as tall as the two
      // lines it occupies. The mark tracks the row, and the row is what varies.
      const box = row ? `${row.offsetTop}:${row.offsetHeight}` : null;
      if (box !== null && box === markerBox.current) return;

      // The first placement is never animated, whatever the caller asked for:
      // the mark has no previous row to have come from, and sliding in from
      // the top of the rail on load would read as content arriving late.
      const glide = animate && markerBox.current !== null;
      markerBox.current = box;

      if (!glide) marker.style.transition = "none";
      if (row) {
        marker.style.transform = `translateY(${row.offsetTop}px)`;
        marker.style.height = `${row.offsetHeight}px`;
      }
      marker.style.opacity = row ? "1" : "0";
      if (!glide) {
        void marker.offsetHeight;
        marker.style.transition = "";
      }
    },
    [markedId],
  );

  useLayoutEffect(() => {
    placeMarker(true);
  }, [placeMarker]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => placeMarker(false));
    observer.observe(content);
    return () => observer.disconnect();
  }, [placeMarker]);

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
        {/* The spine's containing block, and it has to be this wrapper rather
            than the scroller above it: an absolutely positioned child spans its
            containing block's PADDING box, which for a scroll container is one
            viewport's worth — so a spine anchored there would end at the fold
            and slide back to the top as the rail scrolled. Anchored here it
            spans the content. */}
        <div ref={contentRef} className="relative">
          {/* The page's own trunk. Every row hangs off it and the mark that
              says "you are here" rides on it, so it is the one line in the rail
              that is always drawn.

              Exactly the height of the rows, with no inset. It used to hold 4px
              back at each end, from when the mark was a short tick floating in
              the middle of its row and the track's ends were pure decoration.
              A mark that fills its row makes those 4px load-bearing: the first
              row starts at y=0, so the mark overhung the top of the track it
              was supposed to be riding. The track has to be at least as long
              as the thing that travels on it. */}
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 w-0.5 rounded-full bg-foreground/12"
          />
          {/* Sized and positioned entirely from the effect above — `top: 0`
              here and the row's y arrives as a transform, so the travel is
              composited rather than a layout write per frame. Height is a real
              layout property and cannot be, but it only changes on the rare
              move between a one-line row and a wrapped one, and an absolutely
              positioned 2px bar reflows nothing but itself. */}
          <span
            ref={markerRef}
            aria-hidden="true"
            className={cn(
              "absolute top-0 left-0 h-0 w-0.5 rounded-full bg-foreground opacity-0",
              "transition-[transform,height,opacity] duration-200 ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none",
            )}
          />
          <nav aria-label="Sections of this page">
            <ul className="space-y-px">
              {branches.map((branch) => {
                const open = branch.item.id === openBranchId;
                return (
                  <li key={branch.item.id}>
                    <NavEntry
                      item={branch.item}
                      active={branch.item.id === activeId}
                      ref={
                        branch.item.id === activeId ? activeItemRef : undefined
                      }
                      onNavigate={goTo}
                    />
                    {branch.children.length > 0 && (
                      // Same collapse as the record card and header menu, so a
                      // branch opening isn't a third kind of expand. See
                      // header-pill.tsx for why `visibility`.
                      <div
                        className={cn(
                          "grid transition-[grid-template-rows,visibility] duration-400 ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none",
                          open
                            ? "visible grid-rows-[1fr]"
                            : "invisible grid-rows-[0fr]",
                        )}
                      >
                        <div className="min-h-0 overflow-hidden">
                          <NavBranchBody
                            items={branch.children}
                            activeId={activeId}
                            open={open}
                            activeItemRef={activeItemRef}
                            onNavigate={goTo}
                          />
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
    </div>
  );
}

/**
 * One branch: the drawn tree, and the headings it is drawn for.
 *
 * Each row's position is READ, not stepped. A heading that wraps to two lines
 * is ordinary at this width, so a fixed pitch would put every elbow below the
 * first wrap out by a line and a bit — drift that only appears on the skills
 * whose headings happen to be long. `offsetTop` plus the first-line offset
 * gives the real y for each row whatever the ones above it did.
 *
 * The read survives the fold: `overflow: hidden` clips the list, it does not
 * compress it, so a collapsed branch still reports true offsets and the
 * observer only fires when the column itself reflows.
 */
function NavBranchBody({
  items,
  activeId,
  open,
  activeItemRef,
  onNavigate,
}: {
  items: SectionNavItem[];
  activeId: string | null;
  open: boolean;
  activeItemRef: React.RefObject<HTMLAnchorElement | null>;
  onNavigate: (event: React.MouseEvent<HTMLAnchorElement>, id: string) => void;
}) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const [centers, setCenters] = useState<number[]>([]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const measure = () => {
      // Rounded, because each of these becomes the y of a HORIZONTAL 2px arm,
      // and a horizontal stroke snaps on the same rule a vertical one does.
      // The row pitch is fractional (19.25px of leading inside 6px padding),
      // so left alone every other arm would straddle two pixel rows and render
      // as two grey ones. Half a pixel off the text's optical centre is not
      // visible; half the arms being soft is.
      const next = Array.from(list.children).map((row) =>
        Math.round((row as HTMLElement).offsetTop + FIRST_LINE_Y),
      );
      // Bail on an unchanged read. The observer below fires on every reflow of
      // a list this component does not size, and a fresh array each time would
      // be a new render each time.
      setCenters((prev) =>
        prev.length === next.length && prev.every((v, i) => v === next[i])
          ? prev
          : next,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [items]);

  const activeIndex = items.findIndex((item) => item.id === activeId);
  const reach = activeIndex >= 0 ? centers[activeIndex] : undefined;
  const last = centers[centers.length - 1];

  return (
    // `relative` on this wrapper rather than on the <ul>, so the overlay is not
    // an invalid child of a list and the rows still measure from the same
    // origin the paths are drawn against.
    <div className="relative">
      {last !== undefined && (
        <svg
          aria-hidden="true"
          // The extra STROKE is headroom for the round caps, and it is the
          // whole reason the tips look like tips.
          //
          // An outermost <svg> clips to its viewport — that is the UA default,
          // not something we asked for. An arm ends AT `ELBOW_END`, so half its
          // cap lives past it, and a viewport cut to the path's own bounds
          // sliced every dome clean in half. The result was a set of branches
          // that ended in a flat vertical edge no matter what `strokeLinecap`
          // said, which is a confusing bug to chase: the computed style reads
          // `round` and the geometry is right, and only the paint is wrong.
          width={ELBOW_END + STROKE}
          height={last + ELBOW_R + STROKE}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          className={cn(
            "pointer-events-none absolute top-0 left-0 transition-opacity duration-200 ease-out motion-reduce:transition-none",
            // Held back until the fold has most of its height. Lines that
            // arrive with the container read as the tree being unsquashed;
            // lines that arrive once there is room for them read as the tree
            // having been there all along.
            open ? "opacity-100 delay-150" : "opacity-0",
          )}
        >
          <path className="stroke-foreground/25" d={treePath(centers, last)} />
          {/* The route from the section to where the reader actually is. No
              path interpolation and no stroke dashing: the trunk is one
              full-length line scaled down to the reach, and the corner is the
              same elbow the base layer draws, moved onto it. Both are
              composited transforms, and both are transitions rather than
              keyframes, so a fast scroll redirects them from wherever they have
              got to instead of restarting them. */}
          <g
            className={cn(
              "stroke-foreground transition-opacity duration-150 ease-out motion-reduce:transition-none",
              reach === undefined ? "opacity-0" : "opacity-100",
            )}
          >
            <path
              d={`M ${TRUNK_X} 0 V ${last}`}
              className={GLIDE}
              style={{
                ...SVG_ORIGIN,
                transform: `scaleY(${Math.max((reach ?? 0) - ELBOW_R, 0) / last})`,
              }}
            />
            <path
              d={ELBOW}
              className={GLIDE}
              style={{
                ...SVG_ORIGIN,
                transform: `translateY(${reach ?? 0}px)`,
              }}
            />
          </g>
        </svg>
      )}
      <ul ref={listRef} className="space-y-px">
        {items.map((item) => (
          <li key={item.id}>
            <NavEntry
              item={item}
              active={item.id === activeId}
              ref={item.id === activeId ? activeItemRef : undefined}
              onNavigate={onNavigate}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The rail before the skill's own headings are known.
 *
 * It lives beside the real thing rather than in the page's skeleton so that it
 * reads the SAME geometry constants: an indent that drifted here would show up
 * as the whole tree stepping sideways the moment the body landed, and nothing
 * tests that (AGENTS.md — restructure the page, restructure the fallback).
 *
 * The label and the spine are REAL, not placeholders. Neither depends on the
 * data: the rail has a spine whatever the file turns out to contain, so
 * withholding it would hold back the page's structure and then shift it in.
 * Only the entries — the part that genuinely is not known yet — are pending.
 * Six rows, which is roughly what progressive depth shows before a branch
 * opens.
 */
const SKELETON_ROWS = [
  { x: ROW_X, w: 68 },
  { x: ROW_X, w: 104 },
  { x: SUB_X, w: 86 },
  { x: SUB_X, w: 120 },
  { x: SUB_X, w: 74 },
  { x: SUB_X, w: 98 },
];

export function SkillSectionNavSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("hidden lg:block", className)}>
      <p className="mb-4 text-xs font-medium text-muted-foreground">
        On this page
      </p>
      <div className="relative">
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-0.5 rounded-full bg-foreground/12"
        />
        {SKELETON_ROWS.map((row, index) => (
          <div
            key={index}
            className="flex items-center"
            style={{ paddingLeft: row.x, height: ROW_PAD_Y * 2 + LINE_H }}
          >
            <Skeleton className="h-3" style={{ width: row.w }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function NavEntry({
  item,
  active,
  ref,
  onNavigate,
}: {
  item: SectionNavItem;
  active: boolean;
  ref?: React.Ref<HTMLAnchorElement>;
  onNavigate: (event: React.MouseEvent<HTMLAnchorElement>, id: string) => void;
}) {
  const nested = item.level >= 2;

  return (
    <a
      ref={ref}
      href={`#${item.id}`}
      // How the travelling mark finds the row it belongs on. An id rather than
      // a ref map: every one is unique across the outline, and the lookup only
      // ever runs inside an effect.
      data-nav-row={item.id}
      aria-current={active ? "true" : undefined}
      onClick={(event) => onNavigate(event, item.id)}
      style={{
        paddingLeft: nested ? CHILD_X : item.level === 0 ? ROW_X : SUB_X,
        paddingBlock: ROW_PAD_Y,
      }}
      className="group relative block rounded-md focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/50"
    >
      {/* A ghost of the mark, under the cursor only, so the spine reads as
          something you can aim at rather than a decoration. The real mark is
          the one travelling element in the rail and lives up in the nav; this
          is a hover affordance and nothing else, which is why it is drawn at a
          fraction of the strength and never claims a state.

          A nested heading gets neither: its "you are here" is the branch drawn
          to it, and a second indicator 50px from the line already pointing at
          it would only split the reader's attention. */}
      {!nested && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-0.5 rounded-full bg-foreground opacity-0 transition-opacity duration-100 ease-out group-hover:opacity-30 motion-reduce:transition-none"
        />
      )}
      {/* Wraps to two lines rather than truncating. A table of contents whose
          entries end in an ellipsis is worse than one that takes an extra line:
          the reader has to click to find out where a link goes, which is the
          one thing the rail exists to prevent. */}
      <span
        style={{ lineHeight: `${LINE_H}px` }}
        className={cn(
          "line-clamp-2 text-sm transition-colors duration-100 ease-out",
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
