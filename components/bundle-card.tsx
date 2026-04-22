"use client";

import Link from "next/link";
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
  skillCount: number;
  createdAt: number;
  creatorName: string;
  creatorImage?: string;
  isPublic?: boolean;
  actions?: React.ReactNode;
  viewCount?: number;
  copyCount?: number;
  forkCount?: number;
}

export function BundleCard({
  name,
  urlId,
  skillCount,
  createdAt,
  creatorName,
  creatorImage,
  isPublic = true,
  actions,
  viewCount,
  copyCount,
  forkCount,
}: BundleCardProps) {
  const hasStats =
    viewCount !== undefined ||
    copyCount !== undefined ||
    forkCount !== undefined;

  const content = (
    <Card className="gap-3 py-4 transition-colors hover:bg-accent/50">
      <CardHeader className="gap-1">
        <CardTitle className="text-sm leading-snug">{name}</CardTitle>
        <CardAction>
          <div className="flex items-center gap-1.5">
            {!isPublic && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">
                Private
              </Badge>
            )}
            <span className="text-xs font-mono tabular-nums text-muted-foreground">
              {skillCount} skill{skillCount !== 1 ? "s" : ""}
            </span>
          </div>
        </CardAction>
        <CardDescription className="flex items-center gap-1.5 text-xs">
          {creatorImage && (
            <Avatar className="size-4">
              <AvatarImage src={creatorImage} alt={creatorName} />
              <AvatarFallback className="text-[8px]">
                {getInitials(creatorName)}
              </AvatarFallback>
            </Avatar>
          )}
          <span>
            by {creatorName} &middot; {timeAgo(createdAt)}
          </span>
        </CardDescription>
      </CardHeader>
      {hasStats && (
        <CardContent className="pt-0">
          <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-muted-foreground">
            {viewCount !== undefined && (
              <span>
                {viewCount} {viewCount === 1 ? "view" : "views"}
              </span>
            )}
            {copyCount !== undefined && viewCount !== undefined && (
              <span>&middot;</span>
            )}
            {copyCount !== undefined && (
              <span>
                {copyCount} {copyCount === 1 ? "copy" : "copies"}
              </span>
            )}
            {forkCount !== undefined &&
              (viewCount !== undefined || copyCount !== undefined) && (
                <span>&middot;</span>
              )}
            {forkCount !== undefined && (
              <span>
                {forkCount} {forkCount === 1 ? "fork" : "forks"}
              </span>
            )}
          </div>
        </CardContent>
      )}
      {actions && <CardFooter>{actions}</CardFooter>}
    </Card>
  );

  if (actions) {
    return content;
  }

  return <Link href={`/stack/${urlId}`}>{content}</Link>;
}

export function BundleCardSkeleton({ hasStats = false }: { hasStats?: boolean }) {
  return (
    <Card className="gap-3 py-4">
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
      {hasStats && (
        <CardContent className="pt-0">
          <Skeleton className="h-lh w-36 rounded text-xs" />
        </CardContent>
      )}
    </Card>
  );
}
