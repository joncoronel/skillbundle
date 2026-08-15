/**
 * Prod Convex redacts any non-ConvexError thrown from a public function to a
 * generic "Server Error", which the UI can only render as an unactionable
 * mystery. Public actions wrap their handlers with this so transient upstream
 * failures (GitHub hiccup, network reset, a raw throw from a runQuery) reach
 * the user as something they can act on, while real ConvexErrors — quota,
 * rate limit, validation — pass through untouched. The original error still
 * lands in the deployment logs.
 */

import { ConvexError } from "convex/values";

export function toPublicError(
  err: unknown,
  fallback: string,
): ConvexError<string> {
  if (err instanceof ConvexError) return err as ConvexError<string>;
  console.error("public action failure (redacted to friendly message):", err);
  return new ConvexError(fallback);
}
