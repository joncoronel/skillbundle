"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Menu01Icon } from "@hugeicons/core-free-icons";
import { LogoMark } from "@/components/brand-mark";
import { DesktopNav, NAV_ITEMS } from "@/components/header-nav";
import { HeaderAuthClient } from "@/components/header-auth-client";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { SURFACE_SHADOW_COMBINED } from "@/lib/cubby-ui/elevated";
import { cn } from "@/lib/utils";

/**
 * `--pill-ink` is the pill's own foreground, and every control inside it reads
 * from these three rather than from the page's tokens — because the pill is the
 * inverse of the page, anything reaching for `text-muted-foreground` here is
 * styling for the page and goes invisible in light mode. `-dim` is the resting
 * state for anything secondary; `-tint` is the wash used for fills.
 */
const PILL_SURFACE = [
  // Fill inverts, elevation does not. `SURFACE_SHADOW_COMBINED[4]` is the
  // app's level-4 recipe — the same drop and rim every floating surface uses —
  // rather than the `shadow-surface-3` this carried before, which was a drop
  // with no rim and a level that matched nothing.
  //
  // In light the rim tokens are `0 0 transparent`, so this reads purely as the
  // drop: the rim is a dark-mode device, which is also why a near-black pill on
  // a near-white page never needed one. In dark it is the whole difference —
  // a 4% top highlight and a ring that give the pill a defined edge instead of
  // letting `surface-4` fade into the page at 9% separation.
  SURFACE_SHADOW_COMBINED[4],
  "bg-foreground dark:bg-surface-4",
  "[--pill-ink:var(--color-background)]",
  "[--pill-dim:color-mix(in_oklab,var(--color-background)_68%,transparent)]",
  "[--pill-tint:color-mix(in_oklab,var(--color-background)_12%,transparent)]",
  "dark:[--pill-ink:var(--color-foreground)]",
  "dark:[--pill-dim:color-mix(in_oklab,var(--color-foreground)_68%,transparent)]",
  "dark:[--pill-tint:color-mix(in_oklab,var(--color-foreground)_12%,transparent)]",
].join(" ");

/** Shared by the icon-only controls on the pill (menu toggle, theme). */
export const PILL_CONTROL =
  "text-[var(--pill-dim)] hover:text-[var(--pill-ink)] [--btn-bg-hover:var(--pill-tint)] [--btn-bg-active:var(--pill-tint)]";

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
 * (`rounded-lg`). That is why the horizontal inset is `px-3` and not `px-2`: at
 * 8px the trailing gap read visibly tighter than the 12px above and below the
 * Sign-up button, which is the kind of asymmetry you notice without being able
 * to name.
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
 * dark surface. `md` is the first breakpoint the row actually fits in, with
 * ~50px to spare. Anything added to this row has to be checked against that
 * margin, because overflowing again fails silently in the same way.
 */
export function HeaderPill() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col rounded-5xl text-[var(--pill-ink)] md:w-fit md:max-w-full",
        PILL_SURFACE,
      )}
    >
      <div className="flex h-14 w-full items-center gap-1 px-3">
        <Link
          href="/"
          onClick={() => setMenuOpen(false)}
          // `md:mr-5` is the band break between the brand and the nav, and it
          // is a fix rather than a preference. The nav's own items sit 26px
          // apart (12px of link padding either side of a 2px gap) while the
          // wordmark sat 16px from "Official" — the brand was bound TIGHTER to
          // the nav than the nav was to itself, so "skillbundle" read as the
          // first nav item. 20px of margin puts it at 40px, comfortably past
          // the group's internal rhythm, and the eye splits them correctly.
          //
          // No horizontal padding of its own: the mark and the wordmark already
          // make a 138×28 target, and the row's `px-3` puts the mark on the
          // 12px line with nothing to cancel.
          className="flex shrink-0 items-center gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/60 md:mr-5"
        >
          <LogoMark />
          <span className="font-display text-lg font-medium tracking-tight">
            skillbundle
          </span>
        </Link>

        <Suspense fallback={<NavSkeleton />}>
          <DesktopNav />
        </Suspense>

        <div className="ml-auto flex shrink-0 items-center gap-1 md:ml-3">
          <Suspense>
            <div className="max-md:hidden">
              <ThemeSwitcher className={PILL_CONTROL} />
            </div>
          </Suspense>

          <HeaderAuthClient skeletonClassName="bg-[var(--pill-tint)]" />

          {/* A plain button rather than `Button`: its icon-size rules cap the
              glyph at 16px, which was too small to read as a target on the
              pill. 20px in a 36px box instead. */}
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="header-mobile-menu"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-100 ease-out md:hidden",
              "text-[var(--pill-dim)] hover:bg-[var(--pill-tint)] hover:text-[var(--pill-ink)]",
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
          does not match them. */}
      <div
        id="header-mobile-menu"
        className={cn(
          "grid overflow-hidden transition-[grid-template-rows] duration-300 ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none md:hidden",
          menuOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0">
          <Suspense
            fallback={
              <MenuLinks
                activeHref={null}
                onNavigate={() => setMenuOpen(false)}
              />
            }
          >
            <ActiveMenuLinks onNavigate={() => setMenuOpen(false)} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

function ActiveMenuLinks({ onNavigate }: { onNavigate: () => void }) {
  return <MenuLinks activeHref={usePathname()} onNavigate={onNavigate} />;
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
                ? "text-[var(--pill-ink)]"
                : "text-[var(--pill-dim)] hover:text-[var(--pill-ink)]",
            )}
          >
            {item.label}
          </Link>
        );
      })}

      <div className="mt-2 flex items-center justify-between border-t border-[var(--pill-tint)] px-3 pt-3">
        <span className="text-sm font-medium text-[var(--pill-dim)]">
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
      <Skeleton className="h-8 w-16 rounded-lg bg-[var(--pill-tint)]" />
      <Skeleton className="h-8 w-20 rounded-lg bg-[var(--pill-tint)]" />
      <Skeleton className="h-8 w-20 rounded-lg bg-[var(--pill-tint)]" />
      <Skeleton className="h-8 w-16 rounded-lg bg-[var(--pill-tint)]" />
    </nav>
  );
}
