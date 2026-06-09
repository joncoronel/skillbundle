"use client";

import { useLinkStatus } from "next/link";
import { cn } from "@/lib/utils";
import "@/components/link-pending.css";

/**
 * Subtle navigation-pending hint for a <Link> to an on-demand (ISR) route.
 * These routes serve instantly once cached, but the first visitor to an
 * un-generated path waits while it renders — a full-static route can't show a
 * route-level skeleton on a client navigation, so without this the click feels
 * frozen.
 *
 * Renders a small dot in the link's own color to quietly confirm the click. The
 * dot is *always* rendered (fixed size, space reserved) so it never shifts the
 * row, and stays invisible until ~100ms in — a warm/instant navigation resolves
 * first and it's never seen. Only a cold generation reveals it: a muted dot that
 * breathes slowly while the page renders.
 *
 * Must be a child of the <Link> it reports on (`useLinkStatus`).
 */
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      data-pending={pending || undefined}
      className={cn("link-pending", className)}
    />
  );
}
