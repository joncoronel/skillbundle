/**
 * The raw → blob rewrite for GitHub URLs.
 *
 * A `raw.githubusercontent.com` URL serves the file's bytes, which is right for
 * an `<img src>` and wrong for a link a reader clicks: it renders a plain-text
 * page with no repo chrome. `github.com/…/blob/…` is the same file, viewable.
 *
 * This lived in two files — `markdown-content.tsx` (rewriting links inside a
 * SKILL.md) and `skill-document.tsx` (the "View source" affordance) — as
 * character-identical copies, with a comment in the second conceding it mirrored
 * the first. One rule, one home; a fix to the regex now reaches both callers.
 */

// Handles both raw URL shapes GitHub serves:
//   raw.githubusercontent.com/{owner}/{repo}/refs/heads/{ref}/{path}
//   raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}
//
// The host is pinned by the anchor, which is what stops the rewrite from being
// an open redirect: a URL on any other host fails the match and passes through
// untouched — correct for well-known sources, which are not on GitHub at all.
export const RAW_GITHUB_URL_RE =
  /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(?:refs\/(?:heads|tags)\/)?([^/]+)\//;

export function rawToBlobUrl(raw: string): string {
  return raw.replace(RAW_GITHUB_URL_RE, "https://github.com/$1/$2/blob/$3/");
}
