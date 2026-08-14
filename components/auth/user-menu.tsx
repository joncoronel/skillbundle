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
          "cursor-pointer rounded-lg outline-0 outline-offset-0 outline-transparent outline-solid transition-[outline-width,outline-offset,outline-color] duration-100 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50",
          className,
        )}
      >
        {/* A rounded square, not the primitive's circle. This avatar's only
            home is the header pill, and it sits 12px inside a 24px corner —
            so 24 − 12 = 12px (`rounded-lg`) is the radius that keeps the two
            curves concentric. Every other inner corner on the pill is set the
            same way, which is why they all read as one object.

            The fallback needs both of its overrides for the same reason it
            needs the radius: it is drawn for the page, not for the pill. Its
            `rounded-full` would put a disc inside the square root, and its
            `bg-muted` is a light page surface, which on a near-black pill
            renders as a glaring white block that reads as a broken image
            rather than as an avatar. `--pill-tint` is the wash every other
            fill on the pill already uses. */}
        <Avatar size="sm" className="rounded-lg">
          <AvatarImage
            src={user?.imageUrl}
            alt={user?.fullName ?? "User avatar"}
          />
          <AvatarFallback className="rounded-[inherit] bg-[var(--pill-tint)] text-[var(--pill-ink)]">
            {initials}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8}>
        <DropdownMenuLabel className="flex flex-col">
          <span className="text-sm font-medium">{user?.fullName}</span>
          <span className="text-muted-foreground text-xs font-normal">
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
