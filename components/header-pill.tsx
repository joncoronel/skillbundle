"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Menu01Icon } from "@hugeicons/core-free-icons";
import { LogoMark } from "@/components/brand-mark";
import { ActiveNavLinks, NAV_ITEMS } from "@/components/header-nav";
import { HeaderAuthClient } from "@/components/header-auth-client";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { SURFACE_SHADOW_COMBINED } from "@/lib/cubby-ui/elevated";
import { cn } from "@/lib/utils";

/**
 * Fill from the inverse-surface tokens, elevation from the surface ladder.
 *
 * The pill is the opposite of the page it floats over — near-black in light,
 * a lifted `surface-4` in dark — and those two facts live in globals.css as
 * `--inverse` / `--inverse-foreground` (plus three derived), NOT as variables
 * declared here. That distinction is the whole point: the same three values
 * used to be `--pill-ink` / `-dim` / `-tint` inside this file, which made an
 * app-wide idea look like one component's private styling and left every
 * control that entered the pill to be repainted by hand.
 *
 * The elevation is separate on purpose. `solidSurface(4)` would bring
 * `bg-surface-4` with it and fight the inverse fill, so the pill takes the
 * shadow half of that recipe — the identical drop and rim every other floating
 * container in the app gets — and paints its own fill.
 *
 * Level 4's rim is a dark-mode device (`0 0 transparent` in light), which is
 * the right behaviour here for a reason worth keeping: a near-black pill on a
 * near-white page needs no edge, while in dark the fill sits only 9% above the
 * page and the 2% highlight plus 4% ring is what stops it going mushy.
 */
const PILL_SURFACE = cn("bg-inverse", SURFACE_SHADOW_COMBINED[4]);

/**
 * Shared by the icon-only controls on the pill (menu toggle, theme). Not
 * exported — both consumers are in this file.
 */
const PILL_CONTROL =
  "text-inverse-muted-foreground hover:text-inverse-foreground [--btn-bg-hover:var(--color-inverse-hover)] [--btn-bg-active:var(--color-inverse-hover)]";

/**
 * The header pill.
 *
 * A client component because the mobile menu expands the pill itself rather
 * than opening a drawer, so the toggle and the panel it reveals have to share
 * one piece of state — and they live at opposite ends of the same container.
 *
 * ── Concentric insets ─────────────────────────────────────────────────────
 *
 * The pill's corner is 24px and its controls are 32px tall inside a 56px row,
 * so every edge inset is 12px and the inner corners are 24 − 12 = 12px
 * (`rounded-lg`). That is why the trailing inset is `pr-3` and not `pr-2`: at
 * 8px the gap read visibly tighter than the 12px above and below the Sign-up
 * button, which is the kind of asymmetry you notice without being able to name.
 *
 * ── Why the leading inset is 16px and not 12px ────────────────────────────
 *
 * `pl-4` is an optical correction, and the two ends are genuinely different
 * shapes rather than the same one measured twice. Every trailing control ends
 * in a `rounded-lg` box, whose 12px corner radius pulls its visual mass about
 * 3.5px inward from its bounding box. The logo is a glyph whose ink sits 0.41px
 * inside its own box — effectively flush — so at a matched 12px it presented a
 * hard curve tip where the other end presents a receding corner, and read
 * tighter to the edge. 16px puts the two apparent edges on the same line.
 *
 * Measured, not guessed: the mark is 20px tall (36% of the row) against 32px
 * for the trailing control (57%), so there is no shared geometry to fall back
 * on here. Re-check this if the mark ever gains its own padding or the controls
 * change radius.
 *
 * ── Where that inset lives ────────────────────────────────────────────────
 *
 * On the top ROW, not on the pill. The pill is the scroll container for two
 * things with different needs: a row of controls that wants a 12px margin, and
 * a menu of full-bleed rows that wants none. Padding the shared parent serves
 * the first and forces the second to cancel it back out — which is what the
 * menu rows and the logo were both doing with negative margins, each one an
 * invisible dependency on a number set two elements away. With the inset on
 * the row, the menu is an unpadded track and its rows own their own `px-3`.
 * The 12px line is then stated once per element that sits on it.
 *
 * The practical rule: nothing inside this pill should need a negative margin.
 * If something does, the padding is on the wrong element again.
 *
 * ── Why the layout switches at `md` and not `sm` ──────────────────────────
 *
 * Laid out horizontally the row needs about 717px: 685px of content (brand,
 * four nav links, theme, and the widest auth state — the signed-out "Log in /
 * Sign up" pair) plus the page's own 16px gutters. It used to flip at `sm`,
 * where only 608px is available, so between 640 and 717px the pill hit
 * `max-w-full` and its shrink-0 children ran straight out through the rounded
 * corner: nothing clipped, nothing wrapped, the Sign-up button simply left the
 * pill's surface. `md` is the first breakpoint the row actually fits in, with
 * ~50px to spare. Anything added to this row has to be checked against that
 * margin, because overflowing again fails silently in the same way.
 */
export function HeaderPill() {
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Stable, because `ActiveMenuLinks` uses it as an effect dependency — an
  // inline arrow would be a new function every render and re-run that effect.
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Escape, while open. This menu is a disclosure rather than a dialog, so ARIA
  // does not require it, but the panel covers the page and a keyboard user will
  // try it.
  //
  // Focus goes back to the toggle, which is the disclosure pattern's own rule
  // and the reason for the ref. Without it, closing while focus sits on a menu
  // link drops focus to `<body>` — the panel becomes `display: none` under it —
  // and the next Tab restarts from the top of the document, which undoes the
  // point of supporting Escape at all. The ref is ONLY for this; there is no
  // outside-press handler.
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col rounded-5xl text-inverse-foreground md:w-fit md:max-w-full",
        PILL_SURFACE,
      )}
    >
      <div className="flex h-14 w-full items-center gap-1 pr-3 pl-4">
        <Link
          href="/"
          onClick={closeMenu}
          // `md:mr-5` is the band break between the brand and the nav, and it
          // is a fix rather than a preference. The nav's own items sit 26px
          // apart (12px of link padding either side of a 2px gap) while the
          // wordmark sat 16px from "Official" — the brand was bound TIGHTER to
          // the nav than the nav was to itself, so "skillbundle" read as the
          // first nav item. 20px of margin puts it at 40px, comfortably past
          // the group's internal rhythm, and the eye splits them correctly.
          //
          // No horizontal padding of its own: the mark and the wordmark already
          // make a 138×28 target, and the row's leading inset places the mark
          // with nothing to cancel — see "Why the leading inset is 16px and not
          // 12px" above for why that side is `pl-4` and the trailing one
          // `pr-3`.
          className="flex shrink-0 items-center gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/60 md:mr-5"
        >
          <LogoMark />
          {/* The mark alone below `md`. Everything in this row is `shrink-0`,
              so the row could not give way: at a 320px viewport it measured
              329px against 288px available and ran straight out through the
              pill's rounded corner — nothing clipped and nothing wrapped, the
              same silent failure the `sm`→`md` note above describes. The
              wordmark is ~99px of that (90px of letters plus the 8px gap) and
              it is the one part a phone can lose: the mark still identifies
              the app, and it is still a link home. */}
          <span className="font-display text-lg font-medium tracking-tight max-md:hidden">
            skillbundle
          </span>
        </Link>

        {/* One boundary, owned here. `DesktopNav` used to wrap its own, so this
            fallback could never render — `NavSkeleton` was dead code that still
            got maintained, and a caller could neither replace the fallback nor
            tell that its own boundary was inert. */}
        <Suspense fallback={<NavSkeleton />}>
          <ActiveNavLinks />
        </Suspense>

        <div className="ml-auto flex shrink-0 items-center gap-1 md:ml-3">
          {/* No boundary: ThemeSwitcher reads `useTheme` and
              `useSyncExternalStore` and never suspends, so the empty `Suspense`
              that used to wrap this caught nothing. */}
          <div className="max-md:hidden">
            <ThemeSwitcher className={PILL_CONTROL} />
          </div>

          <HeaderAuthClient />

          {/* A plain button rather than `Button`: its icon-size rules cap the
              glyph at 16px, which was too small to read as a target on the
              pill. 20px in a 36px box instead. */}
          <button
            ref={toggleRef}
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="header-mobile-menu"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-100 ease-out md:hidden",
              "text-inverse-muted-foreground hover:bg-inverse-hover hover:text-inverse-foreground",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/60",
            )}
          >
            <HugeiconsIcon
              icon={menuOpen ? Cancel01Icon : Menu01Icon}
              strokeWidth={2}
              className="size-5"
            />
          </button>
        </div>
      </div>

      {/* The menu, as height the pill grows into rather than a drawer over the
          page. `grid-template-rows` 0fr → 1fr is the animation: it needs no
          measured height, so the panel can change size (a longer link list, a
          wrapped label) without anything re-measuring, and the pill's own
          rounded box does the clipping.

          The curve is the same one the drawer, sheet and bundle bar use — this
          app's easing for a surface that opens. Since this panel replaced the
          drawer, matching it is the point. Note those all pair it with
          `duration-400`; this runs at 300ms, which is the one thing here that
          does not match them.

          ── Why the closed state is `display: none` ──────────────────────────

          A clipped block is still in the tab order. Collapsed to `0fr` with
          `overflow-hidden`, the five links and the second theme control stayed
          focusable while the toggle reported `aria-expanded="false"`, and the
          browser would scroll the zero-height box to reveal whichever one took
          focus. `display: none` is the browser's own answer: it removes the
          subtree from the tab order, the accessibility tree and find-in-page at
          once, with no attribute to keep in sync with `menuOpen`. (`inert` did
          the job too, and was what this carried first — but it is a second
          source of truth for the same state.)

          `display` is a discrete property, so animating out of it takes two
          extra pieces, both already used elsewhere in this app:

            transition-discrete  `transition-behavior: allow-discrete`, which
                                 defers the flip TO `none` until the transition
                                 ends, and applies the flip FROM `none`
                                 immediately so there is something to animate.
            starting:grid-rows-[0fr]
                                 `@starting-style`. An element arriving from
                                 `display: none` has no previous computed style
                                 to transition from, so without this the row
                                 would appear at its open height instead of
                                 growing into it.

          The two mechanisms are orthogonal: the height still animates exactly
          as before. Where `@starting-style` is unsupported the menu opens and
          closes with no animation, which is a fine failure — and the closed
          state is still `display: none`, so the focus fix does not depend on
          any of this. */}
      <div
        id="header-mobile-menu"
        className={cn(
          "grid overflow-hidden transition-[grid-template-rows,display] transition-discrete duration-300 ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none md:hidden",
          menuOpen
            ? "grid-rows-[1fr] starting:grid-rows-[0fr]"
            : "hidden grid-rows-[0fr]",
        )}
      >
        {/* The content fades on top of the height, and it needs BOTH halves for
            the same reason the row does: `starting:opacity-0` supplies the
            entry value the element cannot have while its parent is
            `display: none`, and the state-driven `opacity-0` drives the exit,
            which `@starting-style` has no say over.

            Same duration and curve as the height, so it reads as one gesture
            rather than two things moving at once. */}
        <div
          className={cn(
            "min-h-0 transition-opacity duration-300 ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none",
            menuOpen ? "opacity-100 starting:opacity-0" : "opacity-0",
          )}
        >
          <Suspense
            fallback={<MenuLinks activeHref={null} onNavigate={closeMenu} />}
          >
            <ActiveMenuLinks onNavigate={closeMenu} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

/**
 * Reads the pathname AND closes the menu when it changes.
 *
 * The per-link `onClick` handlers below are not enough on their own: they only
 * fire for clicks on the menu's own links, so a browser back/forward, or a link
 * on the page the open panel is covering, left the menu open over a route it no
 * longer describes — still showing `aria-current` for the page you just left.
 * Verified before the fix: after `goBack()` the panel was still displayed.
 *
 * It lives HERE and not in `HeaderPill` because `usePathname()` suspends while
 * the App Shell for a dynamic-param route is generated. This component is
 * already inside the Suspense boundary that exists for exactly that reason;
 * calling the hook one level up would pull the whole pill out of the static
 * shell.
 *
 * The per-link handlers stay, and are not redundant: clicking the link for the
 * page you are already on changes no pathname, so this effect never fires.
 */
function ActiveMenuLinks({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();

  useEffect(() => {
    onNavigate();
  }, [pathname, onNavigate]);

  return <MenuLinks activeHref={pathname} onNavigate={onNavigate} />;
}

function MenuLinks({
  activeHref,
  onNavigate,
}: {
  activeHref: string | null;
  onNavigate: () => void;
}) {
  return (
    // `px-2` here insets the rows from the pill's rounded edge, so the divider
    // and every focus ring stop clear of the corner. The rows keep their own
    // `px-3` on top of it, which puts the labels at 20px — indented from the
    // logo's 12px rather than aligned with it, and reading as a list nested
    // under the header row.
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-2 pt-1 pb-3">
      {NAV_ITEMS.map((item) => {
        const isActive = activeHref === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            onClick={onNavigate}
            className={cn(
              "rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-100 ease-out",
              // Colour only, same rule as the desktop nav in header-nav.tsx —
              // see the NavLink comment there for why the current-page fill
              // went away and what it costs.
              isActive
                ? "text-inverse-foreground"
                : "text-inverse-muted-foreground hover:text-inverse-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}

      <div className="mt-2 flex items-center justify-between border-t border-inverse-border px-3 pt-3">
        <span className="text-sm font-medium text-inverse-muted-foreground">
          Theme
        </span>
        <ThemeSwitcher className={PILL_CONTROL} />
      </div>
    </nav>
  );
}

function NavSkeleton() {
  // Literal widths, not interpolated: Tailwind scans source text, so a
  // `w-${n}` template never makes it into the stylesheet.
  return (
    <nav className="flex items-center gap-1 max-md:hidden">
      <Skeleton className="h-8 w-16 rounded-lg bg-inverse-hover" />
      <Skeleton className="h-8 w-20 rounded-lg bg-inverse-hover" />
      <Skeleton className="h-8 w-20 rounded-lg bg-inverse-hover" />
      <Skeleton className="h-8 w-16 rounded-lg bg-inverse-hover" />
    </nav>
  );
}
