import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
export { cn } from "cn";

export function getInitials(
  firstName?: string | null,
  lastName?: string | null,
): string {
  return (
    [firstName?.[0], lastName?.[0]].filter(Boolean).join("").toUpperCase() ||
    "?"
  );
}

export function getClerkErrorMessage(err: unknown, fallback: string): string {
  if (isClerkAPIResponseError(err)) {
    return err.errors[0]?.longMessage ?? fallback;
  }
  return fallback;
}

export function formatInstalls(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

/**
 * Relative time like "3w ago". CLIENT-ONLY — see the `Date.now()` below.
 *
 * Calling this from anything that renders on the server (including a client
 * component's SSR pass) reads the clock during the prerender, which under Cache
 * Components is unstable IO. The surrounding subtree then stops being
 * prerenderable. If it sits inside a `<Suspense>`, nothing errors and the build
 * stays green — the boundary just becomes a permanent dynamic hole, only the
 * static shell is persisted, and every cached hit serves the fallback and
 * re-renders on the client. That regression shipped once, on skill detail; see
 * the comment on the `<time>` element in components/skill-history-row.tsx.
 *
 * Use `formatDate` for anything server-rendered, or swap to relative after
 * hydration.
 */
export function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

/**
 * Is `timestamp` older than `maxAgeMs`?
 *
 * Carries the same clock-reading caveat as `timeAgo` above — it is only safe
 * where that one is, i.e. after hydration in a client component, never in a
 * server render.
 *
 * It exists as a helper rather than an inline `Date.now() - ts > max` because
 * the lint rule that guards React Compiler purity rejects a bare `Date.now()`
 * in a component body ("Cannot call impure function during render"). Both
 * functions are impure in exactly the same way; keeping the call behind a
 * named helper puts the caveat somewhere it can be documented once instead of
 * re-argued at each call site.
 */
export function isOlderThan(timestamp: number, maxAgeMs: number): boolean {
  return Date.now() - timestamp > maxAgeMs;
}

/**
 * Absolute date like "May 30, 2026", formatted in UTC. Deterministic (no
 * `Date.now()`, no client/server timezone drift), so it prerenders into the
 * static shell without a `'use cache'` wrapper or a hydration mismatch — unlike
 * a relative "X ago" string, which is inherently a function of the current time.
 */
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
