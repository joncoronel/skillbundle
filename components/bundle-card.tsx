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
import { cn, timeAgo } from "@/lib/utils";

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
  isTrending?: boolean;
}

export function BundleCard({
  name,
  urlId,
  skillCount,
  createdAt,
  creatorName,
  isPublic = true,
  actions,
  viewCount,
  isTrending,
}: BundleCardProps) {
  const content = (
    <Card
      className={cn("gap-3 py-4 transition-colors hover:border-border/20", isTrending && "border-l-2 border-l-primary/40")}
    >
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
        <CardDescription className="text-xs">
          by {creatorName} &middot; {timeAgo(createdAt)}
        </CardDescription>
      </CardHeader>
      {viewCount !== undefined && (
        <CardContent className="pt-0">
          <span className="text-xs font-mono tabular-nums text-muted-foreground">
            {viewCount} {viewCount === 1 ? "view" : "views"}
          </span>
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
