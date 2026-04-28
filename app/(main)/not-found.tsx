"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/cubby-ui/button";

export default function NotFound() {
  const pathname = usePathname();

  return (
    <div className="mx-auto max-w-2xl px-4 pt-24 pb-24">
      <p className="font-mono text-xs text-muted-foreground mb-8 tabular-nums truncate">
        <span>GET </span>
        <span className="text-foreground">{pathname}</span>
        <span> 404 NOT_FOUND</span>
      </p>

      <h1 className="font-display text-[clamp(2.5rem,6vw,4rem)] font-semibold tracking-tight leading-hero text-balance mb-6">
        Not in the index.
      </h1>

      <p className="text-base text-muted-foreground leading-relaxed mb-10 max-w-md">
        This page isn&apos;t part of our index. Could be a typo, a stale link,
        or content we haven&apos;t picked up.
      </p>

      <div className="flex flex-wrap gap-3">
        <Button nativeButton={false} render={<Link href="/" />}>
          Back home
        </Button>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/explore" />}
        >
          Browse bundles
        </Button>
      </div>
    </div>
  );
}
