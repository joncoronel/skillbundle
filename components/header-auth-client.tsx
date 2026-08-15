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
export function HeaderAuthClient() {
  const { isSignedIn, isLoaded } = useAuth();

  // The margins sit on the two avatar-shaped branches and NOT on the signed-out
  // pair below, because they compensate for missing padding rather than set a
  // gap. Every other control on the pill pads its own ink — the theme toggle by
  // 8px, a nav link by 12px, the menu button by 8px — so the 4px box gap
  // between any two of them lands as 20-24px of visible space. The avatar is a
  // flush 32px block that pads nothing, so the same 4px landed as 12px and read
  // as a collision. This buys back the padding it doesn't have.
  //
  // Which side depends on the neighbour, which is why it is not `mx-2`: on
  // desktop the avatar abuts the theme toggle on its left and the pill's own
  // 12px inset on its right, and padding that inset out to 20px would break the
  // concentric edge every other control sits on. Below `md` the toggle is gone
  // and the menu button takes the other side, so the offset moves with it.
  const gutters = "ml-2 max-md:mr-2";

  if (!isLoaded)
    return <Skeleton className={cn("size-8 rounded-lg", gutters)} />;

  if (isSignedIn) return <UserMenu className={gutters} />;

  // Two actions, not one. A single "Sign in" made the returning user and the
  // new one share a control, and the new one is the whole point of a header
  // CTA: the quiet link carries the people who already have an account, and
  // the filled button carries the ones who don't.
  return (
    <div className="flex items-center gap-1">
      <Link
        href="/sign-in"
        className="rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors duration-100 ease-out hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/60"
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
