"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/cubby-ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CompassIcon,
  DashboardSquare01Icon,
  Tag01Icon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";

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
    <nav className="max-sm:hidden flex items-center gap-1">
      <NavLink
        href="/explore"
        activeHref={activeHref}
        icon={
          <HugeiconsIcon icon={CompassIcon} strokeWidth={2} className="size-4" />
        }
      >
        Explore
      </NavLink>
      <NavLink
        href="/official"
        activeHref={activeHref}
        icon={
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}
            strokeWidth={2}
            className="size-4"
          />
        }
      >
        Official
      </NavLink>
      <NavLink
        href="/dashboard"
        activeHref={activeHref}
        icon={
          <HugeiconsIcon
            icon={DashboardSquare01Icon}
            strokeWidth={2}
            className="size-4"
          />
        }
      >
        Dashboard
      </NavLink>
      <NavLink
        href="/pricing"
        activeHref={activeHref}
        icon={
          <HugeiconsIcon icon={Tag01Icon} strokeWidth={2} className="size-4" />
        }
      >
        Pricing
      </NavLink>
    </nav>
  );
}

function NavLink({
  href,
  children,
  icon,
  activeHref,
}: {
  href: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
  activeHref: string | null;
}) {
  const isActive = activeHref === href;

  return (
    <Button
      nativeButton={false}
      variant="ghost"
      size="sm"
      render={<Link href={href} aria-current={isActive ? "page" : undefined} />}
      className={cn("gap-1.5", isActive && "bg-surface-selected text-foreground")}
      leftSection={icon}
    >
      {children}
    </Button>
  );
}
