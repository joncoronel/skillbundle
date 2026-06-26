"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/cubby-ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerBody,
  DrawerFooter,
  DrawerHandle,
} from "@/components/ui/cubby-ui/drawer/drawer";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CompassIcon,
  DashboardSquare01Icon,
  GitCompareIcon,
  Menu01Icon,
  Tag01Icon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { LogoMark } from "@/components/brand-mark";
import { cn } from "@/lib/utils";

export function MobileNav() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon_sm"
        className="sm:hidden"
        onClick={() => setDrawerOpen(true)}
        aria-label="Open menu"
      >
        <HugeiconsIcon icon={Menu01Icon} strokeWidth={2} />
      </Button>

      <Drawer direction="bottom" open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent>
          <DrawerHandle />
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2 font-display text-lg font-medium tracking-tight">
              <LogoMark />
              skillbundle
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody className="flex flex-col gap-1 px-4">
            {/* usePathname() suspends during a dynamic route's App Shell; read
                it behind <Suspense> so the drawer still prerenders (the fallback
                renders the same links with no active state). */}
            <Suspense fallback={<DrawerNavLinks activeHref={null} />}>
              <ActiveDrawerNavLinks />
            </Suspense>
          </DrawerBody>
          <DrawerFooter className="px-4">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-sm text-muted-foreground">Theme</span>
              <ThemeSwitcher />
            </div>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  );
}

function ActiveDrawerNavLinks() {
  return <DrawerNavLinks activeHref={usePathname()} />;
}

function DrawerNavLinks({ activeHref }: { activeHref: string | null }) {
  return (
    <>
      <DrawerNavLink
        href="/explore"
        icon={CompassIcon}
        isActive={activeHref === "/explore"}
      >
        Explore
      </DrawerNavLink>
      <DrawerNavLink
        href="/official"
        icon={CheckmarkCircle02Icon}
        isActive={activeHref === "/official"}
      >
        Official
      </DrawerNavLink>
      <DrawerNavLink
        href="/compare"
        icon={GitCompareIcon}
        isActive={activeHref === "/compare"}
      >
        Compare
      </DrawerNavLink>
      <DrawerNavLink
        href="/dashboard"
        icon={DashboardSquare01Icon}
        isActive={activeHref === "/dashboard"}
      >
        Dashboard
      </DrawerNavLink>
      <DrawerNavLink
        href="/pricing"
        icon={Tag01Icon}
        isActive={activeHref === "/pricing"}
      >
        Pricing
      </DrawerNavLink>
    </>
  );
}

function DrawerNavLink({
  href,
  children,
  icon,
  isActive,
}: {
  href: string;
  children: React.ReactNode;
  icon: typeof CompassIcon;
  isActive: boolean;
}) {
  return (
    <DrawerClose
      render={<Link href={href} aria-current={isActive ? "page" : undefined} />}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-surface-hover",
        isActive && "bg-surface-selected text-foreground",
      )}
    >
      <HugeiconsIcon icon={icon} strokeWidth={2} className="size-4" />
      {children}
    </DrawerClose>
  );
}
