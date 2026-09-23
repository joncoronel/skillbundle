/**
 * Constant-time compare for a shared secret a public Convex function receives
 * (the runtime has no `node:crypto`). Fails closed when `expected` is unset.
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
