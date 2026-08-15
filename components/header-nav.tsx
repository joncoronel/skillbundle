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
 * Also the fallback for that boundary, with `activeHref={null}`. That matters
 * more than it looks: the routes whose shell suspends here are `/[org]`,
 * `/[org]/[repo]` and `/site/[source]`, none of which is a top-level nav
 * target, so "no active state" is not a degraded guess — it is the right
 * answer. Rendering real links instead of placeholders means the prerendered
 * HTML for the app's highest-traffic routes ships a working, prefetchable nav
 * rather than boxes that only become links once React hydrates.
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
 * A plain anchor, not the `Button` component: ghost paints from the page's own
 * tokens, which are dark-on-light and vanish against the pill.
 *
 * Nothing here fills. Both hover and the current page are carried by label
 * colour alone: the row rests at `muted-foreground` and lifts to `foreground`.
 * The
 * current page had a tinted fill and lost it deliberately — on a pill this
 * small a filled chip is a heavier mark than the state deserves, and the pill's
 * own surface is already the loudest object on the screen.
 *
 * The cost is that hovering a link makes it look like the current one for as
 * long as the cursor sits there. That is accepted, not overlooked: the pointer
 * is on the link, so the ambiguity resolves itself, and `aria-current` still
 * carries the fact for anything that isn't looking at colour.
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
