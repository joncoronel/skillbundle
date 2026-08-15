"use client";

import { useState } from "react";
import { useUser, useClerk } from "@clerk/nextjs";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DashboardSquare01Icon,
  Settings01Icon,
  Logout01Icon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { cn, getInitials } from "@/lib/utils";
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from "@/components/ui/cubby-ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/cubby-ui/dropdown-menu";
import { Skeleton } from "../ui/cubby-ui/skeleton/skeleton";

export function UserMenu({ className }: { className?: string }) {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const [open, setOpen] = useState(false);

  if (!isLoaded)
    return <Skeleton className={cn("size-8 rounded-lg", className)} />;

  const initials = getInitials(user?.firstName, user?.lastName);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className={cn(
          "cursor-pointer rounded-lg outline-0 outline-offset-0 outline-transparent transition-[outline-width,outline-offset,outline-color] duration-100 ease-out outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50",
          className,
        )}
      >
        {/* A rounded square, not the primitive's circle: this sits 12px inside
            the pill's 24px corner, so 24 − 12 = 12px keeps the two concentric.
            The fallback overrides only its radius — its `bg-muted` needs no
            correction on a near-black pill, because `data-surface="chrome"`
            re-points that token (globals.css). */}
        <Avatar size="sm" className="rounded-lg">
          <AvatarImage
            src={user?.imageUrl}
            alt={user?.fullName ?? "User avatar"}
          />
          <AvatarFallback className="rounded-[inherit]">
            {initials}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8}>
        <DropdownMenuLabel className="flex flex-col">
          <span className="text-sm font-medium">{user?.fullName}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {user?.primaryEmailAddress?.emailAddress ?? ""}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLinkItem
          render={<Link href="/dashboard" />}
          onClick={() => setOpen(false)}
        >
          <HugeiconsIcon
            icon={DashboardSquare01Icon}
            strokeWidth={2}
            className="size-4"
          />
          Dashboard
        </DropdownMenuLinkItem>
        <DropdownMenuLinkItem
          render={<Link href="/settings" />}
          onClick={() => setOpen(false)}
        >
          <HugeiconsIcon
            icon={Settings01Icon}
            strokeWidth={2}
            className="size-4"
          />
          Account settings
        </DropdownMenuLinkItem>
        <DropdownMenuLinkItem
          render={<Link href="/settings?tab=billing" />}
          onClick={() => setOpen(false)}
        >
          <HugeiconsIcon icon={Tag01Icon} strokeWidth={2} className="size-4" />
          Billing
        </DropdownMenuLinkItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            signOut({ redirectUrl: "/sign-in" });
          }}
        >
          <HugeiconsIcon
            icon={Logout01Icon}
            strokeWidth={2}
            className="size-4"
          />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
