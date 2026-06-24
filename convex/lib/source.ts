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

/**
 * A row whose repo resolved to a different live name — a dead renamed alias.
 * `repoLiveName` is stamped by resolveRepoIdentities (duplicate detection); when
 * it's set and differs from the row's own `source`, this row is an old name of a
 * repo that now lives elsewhere. Detail-refresh jobs skip these: the v1 detail
 * endpoint serves a stale, inflated count for a renamed repo's old name.
 */
export function isDeadRenamedAlias(s: {
  repoLiveName?: string;
  source: string;
}): boolean {
  return s.repoLiveName !== undefined && s.repoLiveName !== s.source;
}
