"use client";

import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { StarIcon } from "@hugeicons/core-free-icons";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
} from "@/components/ui/cubby-ui/card";
import { Badge } from "@/components/ui/cubby-ui/badge";
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from "@/components/ui/cubby-ui/avatar";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { timeAgo, getInitials } from "@/lib/utils";

interface BundleCardProps {
  name: string;
  urlId: string;
  description?: string;
  skillCount: number;
  createdAt: number;
  creatorName: string;
  creatorImage?: string;
  isPublic?: boolean;
  actions?: React.ReactNode;
  copyCount?: number;
  forkCount?: number;
  starCount?: number;
}

export function BundleCard({
  name,
  urlId,
  description,
  skillCount,
  createdAt,
  creatorName,
  creatorImage,
  isPublic = true,
  actions,
  copyCount,
  forkCount,
  starCount,
}: BundleCardProps) {
  const hasStats =
    copyCount !== undefined ||
    forkCount !== undefined ||
    starCount !== undefined;

  const content = (
    <Card className="h-full gap-3 py-4 ">
      <CardHeader className="gap-1">
        <CardTitle className="text-sm leading-snug">{name}</CardTitle>
        <CardAction>
          <div className="flex items-center gap-1.5">
            {!isPublic ? (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">
                Private
              </Badge>
            ) : null}
            <span className="text-xs font-mono tabular-nums text-muted-foreground">
              {skillCount} skill{skillCount !== 1 ? "s" : ""}
            </span>
          </div>
        </CardAction>
        <CardDescription className="flex items-center gap-1.5 text-xs">
          {creatorImage ? (
            <Avatar className="size-4">
              <AvatarImage src={creatorImage} alt={creatorName} />
              <AvatarFallback className="text-[8px]">
                {getInitials(creatorName)}
              </AvatarFallback>
            </Avatar>
          ) : null}
          <span>
            by {creatorName} &middot; {timeAgo(createdAt)}
          </span>
        </CardDescription>
        <p className="mt-2 min-h-[2lh] text-xs text-muted-foreground line-clamp-2 wrap-break-word">
          {description}
        </p>
      </CardHeader>
      {hasStats ? (
        <CardContent className="mt-auto pt-0">
          <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-muted-foreground">
            {copyCount !== undefined ? (
              <span>
                {copyCount} {copyCount === 1 ? "copy" : "copies"}
              </span>
            ) : null}
            {forkCount !== undefined && copyCount !== undefined ? (
              <span aria-hidden>&middot;</span>
            ) : null}
            {forkCount !== undefined ? (
              <span>
                {forkCount} {forkCount === 1 ? "fork" : "forks"}
              </span>
            ) : null}
            {starCount !== undefined &&
            (copyCount !== undefined || forkCount !== undefined) ? (
              <span aria-hidden>&middot;</span>
            ) : null}
            {starCount !== undefined ? (
              <span className="inline-flex items-center gap-1">
                <HugeiconsIcon
                  icon={StarIcon}
                  aria-hidden
                  className="size-3 fill-current"
                />
                {starCount}
              </span>
            ) : null}
          </div>
        </CardContent>
      ) : null}
      {actions ? <CardFooter className="mt-auto">{actions}</CardFooter> : null}
    </Card>
  );

  if (actions) {
    return content;
  }

  return (
    <Link href={`/bundle/${urlId}`} className="block h-full">
      {content}
    </Link>
  );
}

export function BundleCardSkeleton({
  hasStats = false,
}: {
  hasStats?: boolean;
}) {
  return (
    <Card className="h-full gap-3 py-4">
      <CardHeader className="gap-1">
        <CardTitle className="text-sm leading-snug">
          <Skeleton className="h-lh w-3/4 rounded" />
        </CardTitle>
        <CardAction>
          <span className="text-xs font-mono tabular-nums invisible">
            0 skills
          </span>
        </CardAction>
        <CardDescription className="flex items-center gap-1.5 text-xs">
          <Skeleton className="size-4 shrink-0 rounded-full" />
          <Skeleton className="h-lh w-28 rounded" />
        </CardDescription>
      </CardHeader>
      {hasStats ? (
        <CardContent className="pt-0">
          <Skeleton className="h-lh w-36 rounded text-xs" />
        </CardContent>
      ) : null}
    </Card>
  );
}
