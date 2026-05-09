"use client";

import { useState } from "react";
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
  Menu01Icon,
  Tag01Icon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { cn } from "@/lib/utils";

export function MobileNav() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

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
            <DrawerTitle className="font-display text-lg font-bold tracking-tight">
              SkillStack
              <span className="ml-0.5 inline-block size-1.5 rounded-full bg-primary align-super" />
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody className="flex flex-col gap-1 px-4">
            <DrawerNavLink
              href="/explore"
              icon={CompassIcon}
              isActive={pathname === "/explore"}
            >
              Explore
            </DrawerNavLink>
            <DrawerNavLink
              href="/official"
              icon={CheckmarkCircle02Icon}
              isActive={pathname === "/official"}
            >
              Official
            </DrawerNavLink>
            <DrawerNavLink
              href="/dashboard"
              icon={DashboardSquare01Icon}
              isActive={pathname === "/dashboard"}
            >
              Dashboard
            </DrawerNavLink>
            <DrawerNavLink
              href="/pricing"
              icon={Tag01Icon}
              isActive={pathname === "/pricing"}
            >
              Pricing
            </DrawerNavLink>
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
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-accent",
        isActive && "bg-accent text-foreground",
      )}
    >
      <HugeiconsIcon icon={icon} strokeWidth={2} className="size-4" />
      {children}
    </DrawerClose>
  );
}
