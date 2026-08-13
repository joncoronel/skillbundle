"use client";

import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { UserMenu } from "@/components/auth/user-menu";
import { Button } from "@/components/ui/cubby-ui/button";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { cn } from "@/lib/utils";

// Fully client-side auth state. Reading auth on the server (cookies) would mark
// every route under the shared layout as dynamic, which blocks the static/ISR
// generation the skill and listing pages rely on. Clerk hydrates auth on the
// client, so we render a placeholder until it's loaded.
export function HeaderAuthClient({
  /**
   * Painted by the caller because this placeholder sits on the header pill,
   * whose surface is the inverse of the page. Skeleton's default fill is tuned
   * for the page and reads as a bright dot against a near-black pill.
   */
  skeletonClassName,
}: {
  skeletonClassName?: string;
}) {
  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded)
    return <Skeleton className={cn("size-8 rounded-lg", skeletonClassName)} />;

  if (isSignedIn) return <UserMenu />;

  // Two actions, not one. A single "Sign in" made the returning user and the
  // new one share a control, and the new one is the whole point of a header
  // CTA: the quiet link carries the people who already have an account, and
  // the filled button carries the ones who don't.
  return (
    <div className="flex items-center gap-1">
      <Link
        href="/sign-in"
        className="rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap text-[var(--pill-dim)] transition-colors duration-100 ease-out hover:text-[var(--pill-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/60"
      >
        Log in
      </Link>
      <Button
        nativeButton={false}
        variant="primary"
        size="sm"
        render={<Link href="/sign-up" />}
      >
        Sign up
      </Button>
    </div>
  );
}
