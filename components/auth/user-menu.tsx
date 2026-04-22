"use client";

import { useState } from "react";
import { useUser, useClerk } from "@clerk/nextjs";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DashboardSquare01Icon,
  UserIcon,
  Settings01Icon,
  Logout01Icon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { getInitials } from "@/lib/utils";
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

export function UserMenu() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const [open, setOpen] = useState(false);

  if (!isLoaded) return <Skeleton className="size-8 rounded-full" />;

  const initials = getInitials(user?.firstName, user?.lastName);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger className="cursor-pointer rounded-full outline-0 outline-offset-0 outline-transparent outline-solid transition-[outline-width,outline-offset,outline-color] duration-100 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50">
        <Avatar size="sm">
          <AvatarImage
            src={user?.imageUrl}
            alt={user?.fullName ?? "User avatar"}
          />
          <AvatarFallback>{initials}</AvatarFallback>
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
          <HugeiconsIcon icon={UserIcon} strokeWidth={2} className="size-4" />
          Manage account
        </DropdownMenuLinkItem>
        <DropdownMenuLinkItem
          render={<Link href="/settings/custom" />}
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
          render={<Link href="/settings/custom?tab=billing" />}
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
