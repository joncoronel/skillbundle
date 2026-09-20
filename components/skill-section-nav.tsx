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
import {
  ELBOW,
  ELBOW_END,
  ELBOW_R,
  STROKE,
  SVG_ORIGIN,
  TRUNK_X,
  labelX,
  treePath,
} from "@/components/skill-section-nav-geometry";
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
 * The one curve in the rail that carries travel. Matches the collapse used by
 * the record card and the header menu, so the branch opening and the line
 * moving inside it are the same gesture.
 */
const GLIDE =
  "transition-transform duration-200 ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none";

/**
 * The page's own trunk. Every row hangs off it and the mark that says "you are
 * here" rides on it, so it is the one line in the rail that is always drawn.
 *
 * Exactly the height of the rows, with no inset. It used to hold 4px back at
 * each end, from when the mark was a short tick floating in the middle of its
 * row and the track's ends were pure decoration. A mark that fills its row
 * makes those 4px load-bearing: the first row starts at y=0, so the mark
 * overhung the top of the track it was supposed to be riding. The track has to
 * be at least as long as the thing that travels on it.
 *
 * A component, not a copied span, because the rail and its loading skeleton
 * both draw it and a restyle that moved one and not the other would be
 * invisible until the body landed.
 */
function RailSpine() {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-y-0 left-0 w-0.5 rounded-full bg-foreground/12"
    />
  );
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
   * Which branch the current heading belongs to, or -1.
   *
   * The rail asks this once and two things read the answer: the fold below,
   * and the spine mark. They have to agree, so they share the lookup rather
   * than each running the predicate.
   */
  const owningIndex = useMemo(
    () =>
      branches.findIndex(
        (branch) =>
          branch.item.id === activeId ||
          branch.children.some((child) => child.id === activeId),
      ),
    [branches, activeId],
  );

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
    if (owningIndex === -1) return null;
    const owner = branches[owningIndex];
    if (owner.item.level === 0 && branches[owningIndex + 1]) {
      return branches[owningIndex + 1].item.id;
    }
    return owner.item.id;
  }, [branches, owningIndex]);

  /**
   * Which row the spine mark sits on.
   *
   * The head that owns the current heading, not the heading itself — a nested
   * heading's "you are here" is the branch drawn to it, and the mark's job is
   * the level above that: which section of the page you are in. The head's
   * LABEL stays muted and keeps no `aria-current`, so the current link is
   * still unambiguous.
   *
   * Derived from the SAME `owningIndex` the fold above reads, not from a
   * second copy of the predicate. Two copies of one rule is how the mark ends
   * up pointing at a branch the rail did not open.
   */
  const markedId = owningIndex === -1 ? null : branches[owningIndex].item.id;

  const railRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const activeItemRef = useRef<HTMLAnchorElement | null>(null);

  /**
   * Where the spine mark sits, and whether it should travel to get there.
   *
   * ONE element that moves, rather than a tick per row fading in and out. The
   * spine is a continuous line and the mark is a position ON it, so a mark
   * that jumps between rows is claiming the reader teleported; one that slides
   * says they moved down the page, which is what happened. It rides the same
   * curve as the branch elbow, so the two things the rail animates are visibly
   * one gesture.
   *
   * State rather than direct style writes, which also means the transition is
   * a CLASS that lands in the same commit as the position. The imperative
   * version had to set `transition: none`, write the style, force a reflow to
   * flush it, then restore the transition. React applies both in one paint, so
   * the reflow and the restore both go away.
   */
  const [mark, setMark] = useState<{
    top: number;
    height: number;
    glide: boolean;
  } | null>(null);

  /**
   * Read the marked row's box.
   *
   * `markedId` arrives through a ref so this callback never changes identity.
   * It used to close over the value, which re-created the ResizeObserver every
   * time the reader crossed into a new section: a disconnect, a reconstruct
   * and an extra callback, over and over, all the way down a 20,000px file,
   * for an observer that does not care which row is marked.
   *
   * `glide: false` is for reflow, and the distinction matters more than it
   * looks. Opening a branch moves every row below it for 400ms, and a mark
   * that eased toward a moving target would trail its own row the whole way.
   * Snapping means it tracks the row exactly through the fold. The unchanged
   * bail is what keeps the glide alive in the ordinary case: when the marked
   * row has not moved, a reflow elsewhere in the rail returns the previous
   * state object, React skips the render, and the in-flight transition is left
   * alone instead of being cut short.
   */
  const markedIdRef = useRef(markedId);
  const placeMark = useCallback((animate: boolean) => {
    const content = contentRef.current;
    const id = markedIdRef.current;
    if (!content || !id) return;

    const row = content.querySelector<HTMLElement>(
      `[data-nav-row="${CSS.escape(id)}"]`,
    );
    if (!row) return;

    // The row's WHOLE box, padding included, not a tick centred on its text.
    // A short mark on a tall row leaves the spine mostly unlit and reads as a
    // dot that happens to be near an entry; one that fills the row reads as
    // the row being the selected one, which is what it means. It also closes
    // the gaps: consecutive positions meet at the 1px row seam.
    //
    // `offsetHeight`, so a heading that wraps gets a mark as tall as the two
    // lines it occupies. The mark tracks the row, and the row is what varies.
    const top = row.offsetTop;
    const height = row.offsetHeight;
    setMark((prev) => {
      if (prev && prev.top === top && prev.height === height) return prev;
      // The first placement is never animated, whatever the caller asked for:
      // the mark has no previous row to have come from, and sliding in from
      // the top of the rail on load would read as content arriving late.
      return { top, height, glide: animate && prev !== null };
    });
  }, []);

  useLayoutEffect(() => {
    markedIdRef.current = markedId;
    placeMark(true);
  }, [markedId, placeMark]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => placeMark(false));
    observer.observe(content);
    return () => observer.disconnect();
  }, [placeMark]);

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
          <RailSpine />
          {/* Sized and positioned entirely from `placeMark` — `top: 0` here
              and the row's y arrives as a transform, so the travel is
              composited rather than a layout write per frame. Height is a real
              layout property and cannot be, but it only changes on the rare
              move between a one-line row and a wrapped one, and an absolutely
              positioned 2px bar reflows nothing but itself. */}
          <span
            aria-hidden="true"
            style={
              mark
                ? {
                    transform: `translateY(${mark.top}px)`,
                    height: mark.height,
                  }
                : undefined
            }
            className={cn(
              "absolute top-0 left-0 h-0 w-0.5 rounded-full bg-foreground",
              mark ? "opacity-100" : "opacity-0",
              mark?.glide
                ? "transition-[transform,height,opacity] duration-200 ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none"
                : "transition-none",
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
      const rows = Array.from(list.children) as HTMLElement[];
      const labels = rows.map((row) =>
        row.querySelector<HTMLElement>("[data-nav-label]"),
      );
      // One read for the whole branch: every label shares a font size and a
      // leading, so the line box is the same for all of them.
      const first = labels.find(Boolean);
      const leading = first
        ? parseFloat(getComputedStyle(first).lineHeight)
        : Number.NaN;
      const base = list.getBoundingClientRect().top;

      // The FIRST LINE's centre, read off the DOM rather than computed from a
      // px constant. `text-sm` is rem, so the line box grows with the reader's
      // browser font size; a hardcoded one stopped matching its own glyphs the
      // moment anyone enlarged the text, and the elbows drifted off the lines
      // they point at. Measuring costs one `getComputedStyle` per reflow and
      // is correct at every type size.
      //
      // Rounded, because each of these becomes the y of a HORIZONTAL 2px arm,
      // and a horizontal stroke snaps on the same rule a vertical one does.
      // The row pitch is fractional, so left alone every other arm would
      // straddle two pixel rows and render as two grey ones. Half a pixel off
      // the text's optical centre is not visible; half the arms being soft is.
      const next = rows.map((row, index) => {
        const target = labels[index] ?? row;
        const box = target.getBoundingClientRect();
        const line = Number.isFinite(leading) ? leading : box.height;
        return Math.round(box.top - base + line / 2);
      });
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

  /**
   * Where the accent stays while it fades out.
   *
   * `reach` goes undefined the moment the branch stops owning the current
   * heading, which includes the ordinary case of scrolling up onto the
   * branch's own head with the branch still open and fully visible. Falling
   * back to 0 there sent the line racing back up the trunk over 200ms while
   * the group faded over 150, so leaving a section played a retraction nobody
   * asked for. Holding the last position means only the opacity changes, and
   * the line is already where it belongs if the reader scrolls straight back
   * in.
   *
   * Set during render on purpose: this is React's own "adjusting state when
   * props change" pattern, which re-renders before paint and costs nothing
   * here because the branch is already re-rendering for the same `activeId`.
   * An effect is the wrong tool and the lint rule says so.
   */
  const [heldReach, setHeldReach] = useState(0);
  if (reach !== undefined && reach !== heldReach) setHeldReach(reach);
  const y = reach ?? heldReach;

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
                transform: `scaleY(${Math.max(y - ELBOW_R, 0) / last})`,
              }}
            />
            <path
              d={ELBOW}
              className={GLIDE}
              style={{ ...SVG_ORIGIN, transform: `translateY(${y}px)` }}
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
 * It lives beside the real thing so it can share the pieces that must not
 * drift: `labelX` for the indents, `RailSpine` for the track, and the same
 * row classes. An indent or a row pitch that drifted here would show up as the
 * whole rail stepping the moment the body landed, and nothing tests that
 * (AGENTS.md — restructure the page, restructure the fallback).
 *
 * Its OUTER classes matter as much as its inner ones, and that is the
 * non-obvious part. The sidebar is one `lg:flex lg:max-h-[calc(100dvh-7rem)]`
 * column (skill-sidebar.tsx), so anything in it has to be able to shrink. The
 * real rail can: it is a flex column with `min-h-0` over a scrolling child. A
 * plain block here is a flex item at `min-height: auto`, which cannot shrink
 * below its content, so on a short viewport the loading sidebar overran the
 * sticky box and snapped when the body arrived. Same container shape, same
 * behaviour.
 *
 * The label and the spine are REAL, not placeholders. Neither depends on the
 * data: the rail has a spine whatever the file turns out to contain, so
 * withholding it would hold back the page's structure and then shift it in.
 * The `<nav>` is real for the same reason, carrying `aria-busy` rather than
 * appearing from nowhere and changing the page's landmark inventory mid-load.
 * Only the entries — the part that genuinely is not known yet — are pending.
 * Six rows, which is roughly what progressive depth shows before a branch
 * opens.
 */
const SKELETON_ROWS = [
  { level: 0, w: 68 },
  { level: 0, w: 104 },
  { level: 1, w: 86 },
  { level: 1, w: 120 },
  { level: 1, w: 74 },
  { level: 1, w: 98 },
];

export function SkillSectionNavSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("hidden lg:flex lg:min-h-0 lg:flex-col", className)}>
      <p className="mb-4 shrink-0 text-xs font-medium text-muted-foreground">
        On this page
      </p>
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="relative">
          <RailSpine />
          <nav aria-label="Sections of this page" aria-busy="true">
            <ul className="space-y-px">
              {SKELETON_ROWS.map((row, index) => (
                <li key={index}>
                  {/* Same `py-1.5` + `text-sm leading-snug` a real row uses, so
                      the pitch matches at any browser font size. The bar is
                      inline-block, so the line box is still the text's own
                      strut rather than the bar's height. */}
                  <div
                    className="py-1.5 text-sm leading-snug"
                    style={{ paddingLeft: labelX(row.level) }}
                  >
                    <Skeleton
                      className="inline-block h-3 align-middle"
                      style={{ width: row.w }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </nav>
        </div>
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
      // Only the INDENT is a px constant. The vertical metrics are `py-1.5`
      // and `leading-snug` below, which are rem and scale with the reader's
      // browser font size; the branch body reads the result rather than
      // assuming it. Nothing about the horizontal tree scales with type size,
      // so px is right there and wrong here.
      style={{ paddingLeft: labelX(item.level) }}
      className="group relative block rounded-md py-1.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/50"
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
        // What the branch body measures to place its elbows. See the `measure`
        // in NavBranchBody.
        data-nav-label=""
        className={cn(
          "line-clamp-2 text-sm leading-snug transition-colors duration-100 ease-out",
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
