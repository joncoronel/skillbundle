import { Suspense } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { DesktopNav } from "@/components/header-nav";
import { MobileNav } from "@/components/mobile-nav";
import { HeaderAuthClient } from "@/components/header-auth-client";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-sm">
      <div className="flex h-14 items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6">
          <Suspense>
            <MobileNav />
          </Suspense>

          <Link href="/" className="flex items-center">
            <BrandMark />
          </Link>

          <Suspense fallback={<NavSkeleton />}>
            <DesktopNav />
          </Suspense>
        </div>

        <div className="flex items-center gap-3">
          <Suspense>
            <div className="max-sm:hidden">
              <ThemeSwitcher />
            </div>
          </Suspense>

          <HeaderAuthClient />
        </div>
      </div>
    </header>
  );
}

function NavSkeleton() {
  return (
    <nav className="max-sm:hidden flex items-center gap-1">
      <Skeleton className="h-8 w-[82px] rounded-md" />
      <Skeleton className="h-8 w-[102px] rounded-md" />
      <Skeleton className="h-8 w-[78px] rounded-md" />
    </nav>
  );
}
