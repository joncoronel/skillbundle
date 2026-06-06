"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * A skill link that prefetches only on hover/focus, not in the viewport.
 *
 * Skill routes are instant-navigation routes whose content is rendered (and
 * cached) when prefetched. The default viewport prefetch would render every
 * visible skill on a listing page — a Convex+Shiki request per row. Prefetching
 * only on hover/focus limits that work to the skills the user actually points
 * at, while still warming the cache in time for the click so navigation stays
 * instant.
 */
export function HoverPrefetchLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const prefetch = () => router.prefetch(href);

  return (
    <Link
      href={href}
      prefetch={false}
      onMouseEnter={prefetch}
      onFocus={prefetch}
      className={className}
    >
      {children}
    </Link>
  );
}
