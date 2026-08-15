"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Menu01Icon } from "@hugeicons/core-free-icons";
import { LogoMark } from "@/components/brand-mark";
import { ActiveNavLinks, NAV_ITEMS, NavLinks } from "@/components/header-nav";
import { HeaderAuthClient } from "@/components/header-auth-client";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { cn } from "@/lib/utils";

/**
 * A FLUSH surface — no drop shadow in either theme. `--surface-shadow-1` is the
 * ladder's hairline-ring-no-drop level, so the pill's own edge tokens carry the
 * rest; globals.css has the scanlines for why they aren't the ladder's.
 * `solidSurface(1)` is not used because it would bring `bg-surface-1` along and
 * fight the chrome fill.
 */
const PILL_SURFACE = cn(
  "bg-chrome",
  "shadow-[var(--chrome-hairline),var(--surface-shadow-1),var(--chrome-rim)]",
);

/**
 * The header pill.
 *
 * A client component because the mobile menu expands the pill itself rather
 * than opening a drawer, so the toggle and the panel it reveals have to share
 * one piece of state — and they live at opposite ends of the same container.
 *
 * ── Concentric insets ─────────────────────────────────────────────────────
 * 24px corner, 32px controls in a 56px row ⇒ 12px inset everywhere, and 24 − 12
 * = 12px inner corners (`rounded-lg`). Hence `pr-3`, not `pr-2`.
 *
 * The leading inset is `pl-4` — an optical correction, not an inconsistency.
 * Trailing controls end in a rounded box whose corner pulls its mass ~3.5px
 * inward; the logo is a glyph sitting 0.41px inside its box, effectively flush,
 * so at a matched 12px it read tighter. Re-check if the mark gains padding or
 * the controls change radius.
 *
 * Both sit on the top ROW, not the pill, because the menu below wants a
 * full-bleed track and its rows own their own `px-3`. The rule that keeps this
 * honest: nothing in this pill should need a negative margin. If something
 * does, the padding is on the wrong element.
 *
 * ── Why the layout switches at `md` and not `sm` ──────────────────────────
 * The horizontal row needs ~717px (685px of content + 16px gutters). At `sm`
 * only 608px is available, so between 640 and 717px the shrink-0 children ran
 * straight out through the rounded corner — nothing clipped, nothing wrapped,
 * the Sign-up button simply left the pill. `md` fits with ~50px to spare. Check
 * anything added to this row against that margin; overflow fails silently.
 */
export function HeaderPill() {
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Stable, because `ActiveMenuLinks` uses it as an effect dependency — an
  // inline arrow would be a new function every render and re-run that effect.
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // A disclosure, so ARIA doesn't require Escape — but the panel covers the page
  // and people try it. Focus must return to the toggle (the only reason for the
  // ref): otherwise closing drops focus to `<body>` as the panel hides under it,
  // and the next Tab restarts from the top of the document. No outside-press
  // handler, deliberately.
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
    // Lets everything below use ordinary page classes and still paint on a
    // near-black fill; the rule is in globals.css. Remove it and the pill goes
    // dark-on-dark.
    <div
      data-surface="chrome"
      className={cn(
        "mx-auto flex w-full flex-col rounded-5xl text-foreground md:w-fit md:max-w-full",
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
          // with nothing to cancel — see the leading-inset paragraph above for
          // why that side is `pl-4` and the trailing one `pr-3`.
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

        {/* The fallback is the real links, not a skeleton — the only thing
            unknown while this suspends is which one is current. See NavLinks. */}
        <Suspense fallback={<NavLinks activeHref={null} />}>
          <ActiveNavLinks />
        </Suspense>

        <div className="ml-auto flex shrink-0 items-center gap-1 md:ml-3">
          {/* No boundary: ThemeSwitcher reads `useTheme` and
              `useSyncExternalStore` and never suspends, so the empty `Suspense`
              that used to wrap this caught nothing. */}
          <div className="max-md:hidden">
            <ThemeSwitcher />
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
              "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
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

      {/* Height the pill grows into, not a drawer over the page. `0fr → 1fr`
          needs no measured height, so the panel can resize freely.

          ── Why the closed state is `visibility: hidden` ─────────────────────
          `overflow-hidden` alone leaves the clipped links focusable, and the
          browser scrolls the zero-height box to reveal whichever takes focus.
          `visibility` fixes that from the same class that drives the height —
          no second piece of state — and is transitionable everywhere.

          Both alternatives were measured in Firefox 153 and Chromium and are
          worse: `inert` is a second source of truth and still leaves the links
          in the aria snapshot, and `display: none` needs `allow-discrete`, which
          Firefox ships WITHOUT applying it to `display`
          (mdn/browser-compat-data#26155) — so the close snapped there, with no
          feature query to gate on. The record card and section rail match. */}
      <div
        id="header-mobile-menu"
        className={cn(
          "grid overflow-hidden transition-[grid-template-rows,visibility] duration-300 ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none md:hidden",
          menuOpen ? "visible grid-rows-[1fr]" : "invisible grid-rows-[0fr]",
        )}
      >
        {/* Fades on top of the height, same duration and curve so the two read
            as one gesture. No `@starting-style` needed — the element is always
            rendered, so the class swap transitions on its own both ways. */}
        <div
          className={cn(
            "min-h-0 transition-opacity duration-300 ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none",
            menuOpen ? "opacity-100" : "opacity-0",
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
 * Reads the pathname AND closes the menu when it changes — the per-link
 * `onClick`s miss browser back/forward and links on the covered page, which left
 * the panel open over a route it no longer described. They still stay: clicking
 * the current page's own link changes no pathname, so this effect won't fire.
 *
 * Must live here, not in `HeaderPill`: `usePathname()` suspends while a
 * dynamic-param route's App Shell is generated, so calling it one level up would
 * pull the whole pill out of the static shell.
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
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}

      <div className="mt-2 flex items-center justify-between border-t border-border px-3 pt-3">
        <span className="text-sm font-medium text-muted-foreground">Theme</span>
        <ThemeSwitcher />
      </div>
    </nav>
  );
}
