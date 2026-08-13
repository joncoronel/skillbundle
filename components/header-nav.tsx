"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * One list, read by the horizontal nav here and by the expanding mobile menu in
 * header-pill.tsx. They used to be two hand-maintained arrays and had already
 * drifted: the drawer carried a Compare link the desktop header never showed.
 *
 * `menuOnly` preserves that difference rather than quietly resolving it, since
 * which links belong in the header is a product call and not a styling one —
 * but it now lives in one place where the asymmetry is visible and deliberate
 * instead of being an accident of two lists nobody diffed.
 */
export const NAV_ITEMS = [
  { href: "/official", label: "Official" },
  { href: "/compare", label: "Compare", menuOnly: true },
  { href: "/add", label: "Add skill" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/pricing", label: "Pricing" },
] as const satisfies readonly {
  href: string;
  label: string;
  menuOnly?: boolean;
}[];

// `usePathname()` suspends while the App Shell for a dynamic-param route is
// generated (the pathname isn't known yet). Read it behind a <Suspense> so the
// nav still prerenders into the static shell; the fallback renders the same
// links with no active state, which is correct for any route that isn't itself
// a top-level nav target.
export function DesktopNav() {
  return (
    <Suspense fallback={<NavLinks activeHref={null} />}>
      <ActiveNavLinks />
    </Suspense>
  );
}

function ActiveNavLinks() {
  return <NavLinks activeHref={usePathname()} />;
}

function NavLinks({ activeHref }: { activeHref: string | null }) {
  return (
    <nav aria-label="Main" className="flex items-center gap-0.5 max-sm:hidden">
      {NAV_ITEMS.filter((item) => !("menuOnly" in item && item.menuOnly)).map(
        (item) => (
          <NavLink key={item.href} href={item.href} activeHref={activeHref}>
            {item.label}
          </NavLink>
        ),
      )}
    </nav>
  );
}

/**
 * A plain anchor, not the `Button` component: ghost paints from the page's own
 * tokens, which are dark-on-light and vanish against the pill.
 *
 * Hover changes the LABEL only — no fill. The fill is reserved for the current
 * page, so the two states say different things: colour means "you can go
 * here", a filled pill means "you are here". Giving hover a fill too made
 * every pass of the cursor look like a selection change.
 */
function NavLink({
  href,
  children,
  activeHref,
}: {
  href: string;
  children: React.ReactNode;
  activeHref: string | null;
}) {
  const isActive = activeHref === href;

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors duration-100 ease-out",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/60",
        isActive
          ? "bg-[var(--pill-tint)] text-[var(--pill-ink)]"
          : "text-[var(--pill-dim)] hover:text-[var(--pill-ink)]",
      )}
    >
      {children}
    </Link>
  );
}
