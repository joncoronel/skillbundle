/**
 * A skill's `source` is either a GitHub "owner/repo" or a well-known domain
 * (e.g. "example.com"). This is the cheap shape check used to branch content
 * fetching (raw GitHub tree vs. v1 detail) and duplicate resolution.
 *
 * NOTE: shape-only — it requires exactly two slash-parts with a dot-free owner,
 * which rules out domains but does NOT fully sanitize a path. Anything that
 * interpolates `source` into a URL must validate separately (see isSafeRepoPath
 * in lib/github.ts).
 */
export function isGitHubSource(source: string): boolean {
  const parts = source.split("/");
  return parts.length === 2 && !parts[0].includes(".");
}
