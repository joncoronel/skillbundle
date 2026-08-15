"use client";

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
// generated (the pathname isn't known yet). The <Suspense> that makes this safe
// lives in header-pill.tsx, next to the fallback it needs.
export function ActiveNavLinks() {
  return <NavLinks activeHref={usePathname()} />;
}

/**
 * Also that boundary's fallback, with `activeHref={null}`. The routes that
 * suspend are `/[org]`, `/[org]/[repo]` and `/site/[source]` — none a nav target
 * — so "nothing active" is the right answer, not a degraded guess, and the
 * prerendered HTML ships prefetchable links instead of placeholder boxes.
 */
export function NavLinks({ activeHref }: { activeHref: string | null }) {
  return (
    <nav aria-label="Main" className="flex items-center gap-0.5 max-md:hidden">
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
 * Nothing here fills. Hover and the current page are both carried by label
 * colour alone — resting at `muted-foreground`, lifting to `foreground`. The
 * current page had a tinted fill and lost it deliberately: on a pill this small
 * a filled chip is heavier than the state deserves.
 *
 * The cost is that a hovered link looks like the current one while the cursor
 * sits there. Accepted, not overlooked: the pointer resolves the ambiguity, and
 * `aria-current` carries the fact for anything not looking at colour.
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
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
