import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time compare for shared secrets on unauthenticated route handlers.
 * Fails closed on length mismatch (which also avoids timingSafeEqual's throw on
 * unequal-length buffers).
 *
 * KEEP SHARED SECRETS ASCII (hex or base64, e.g. `openssl rand -hex 32`). The
 * provided value arrives from a header, which undici decodes as latin1, while
 * the expected value comes from `process.env` as UTF-8. Any non-ASCII codepoint
 * therefore produces different bytes on the two sides and can never match. It
 * fails closed, so this is not a bypass — it is a secret that silently never
 * works, which on a credential relay looks like an unexplained permanent
 * fallback rather than a configuration error.
 */
export function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
