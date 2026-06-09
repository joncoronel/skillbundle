"use client";

import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { UserMenu } from "@/components/auth/user-menu";
import { Button } from "@/components/ui/cubby-ui/button";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";

// Fully client-side auth state. Reading auth on the server (cookies) would mark
// every route under the shared layout as dynamic, which blocks the static/ISR
// generation the skill and listing pages rely on. Clerk hydrates auth on the
// client, so we render a placeholder until it's loaded.
export function HeaderAuthClient() {
  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded) return <Skeleton className="size-8 rounded-full" />;

  if (isSignedIn) return <UserMenu />;

  return (
    <Button
      nativeButton={false}
      variant="primary"
      size="sm"
      render={<Link href="/sign-in" />}
    >
      Sign in
    </Button>
  );
}
