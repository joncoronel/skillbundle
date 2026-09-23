/**
 * Constant-time string compare for a shared secret a PUBLIC Convex function
 * receives as an argument (the site's server actions calling in with a secret
 * only Vercel and Convex know). The Convex runtime has no `node:crypto`, so
 * this is the site's `lib/shared-secret.ts` rewritten without it: the loop
 * always walks the expected length, whatever the input, and a length mismatch
 * fails closed.
 *
 * Fails closed when `expected` is unset or empty, so a deployment missing the
 * env var refuses everything rather than accepting "".
 */
export function secretMatches(
  provided: string,
  expected: string | undefined,
): boolean {
  if (!expected) return false;
  let diff = provided.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) {
    // `|| 0` covers `provided` being shorter; the mismatch is already in `diff`.
    diff |= (provided.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
