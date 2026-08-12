import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time compare for shared secrets on unauthenticated route handlers.
 * Fails closed on length mismatch (which also avoids timingSafeEqual's throw on
 * unequal-length buffers).
 *
 * Node-only — do not import into a Client Component.
 */
export function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
