import { ConvexError } from "convex/values";

/**
 * The readable message a Convex function refused with, or undefined when there
 * is none.
 *
 * Server refusals put their prose in `ConvexError.data`, either as the whole
 * string or as `{ code, message }` (quota, rate limit, checkout validation).
 * `error.message` on the client is not that prose: it is the serialized payload
 * with a request id in front, so UI should read this first and fall back to its
 * own copy.
 */
export function convexErrorMessage(err: unknown): string | undefined {
  if (!(err instanceof ConvexError)) return undefined;
  if (typeof err.data === "string") return err.data;
  const message = (err.data as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : undefined;
}
