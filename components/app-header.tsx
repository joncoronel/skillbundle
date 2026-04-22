import { Suspense } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { DesktopNav } from "@/components/header-nav";
import { MobileNav } from "@/components/mobile-nav";
import { HeaderAuth } from "@/components/header-auth";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
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

          <Suspense fallback={<Skeleton className="size-8 rounded-full" />}>
            <HeaderAuth />
          </Suspense>
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
