// Repo-match demo allowlist.
//
// Repo match (GitHub auto-detection) is a Pro feature, but a small allowlist of
// demo repos runs free for everyone — signed out included — so people can see
// the feature work before paying. The gate is enforced server-side in
// convex/recommendations.ts; the client mirrors this list to show the demo (and
// the paywall) without a wasted, server-rejected round-trip.
//
// Shared by both the Convex backend (../lib/repo-match) and the client
// (@/lib/repo-match) so the two can never drift.

/** The repo shown in the repo-mode empty state's "Try it" button. */
export const EXAMPLE_REPO_SLUG = "shadcn-ui/ui";
export const EXAMPLE_REPO_URL = `https://github.com/${EXAMPLE_REPO_SLUG}`;

// Lowercased `owner/repo` slugs anyone can analyze for free.
const DEMO_REPO_SLUGS: ReadonlySet<string> = new Set([EXAMPLE_REPO_SLUG]);

/** True when this owner/repo is on the free demo allowlist (case-insensitive). */
export function matchesDemoRepo(owner: string, repo: string): boolean {
  return DEMO_REPO_SLUGS.has(`${owner.toLowerCase()}/${repo.toLowerCase()}`);
}

// Host match is case-insensitive so `GitHub.com/...` resolves like `github.com`.
const GITHUB_URL_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+)/i;
const BARE_SLUG_RE = /^([\w.-]+)\/([\w.-]+)$/;

/**
 * Extract `{ owner, repo }` from a GitHub URL or a bare `owner/repo` slug.
 * This is THE canonical parser: convex/github.ts's `parseGitHubUrl` and the
 * composer's repo-shape check both delegate here, so the server, the demo
 * allowlist, and input validation can never disagree. Returns null when the
 * input isn't repo-shaped.
 */
export function extractRepoSlug(
  input: string,
): { owner: string; repo: string } | null {
  // Drop the query/fragment BEFORE stripping `.git` — otherwise a URL like
  // `…/ui.git#readme` keeps its suffix (it's no longer at the end) and parses
  // as repo `ui.git`, which would miss the allowlist and send a demo repo to
  // the paywall.
  let cleaned = input.trim().split("?")[0].split("#")[0];
  cleaned = cleaned.replace(/\/+$/, "").replace(/\.git$/, "");

  const url = cleaned.match(GITHUB_URL_RE);
  if (url) return { owner: url[1], repo: url[2] };
  const bare = cleaned.match(BARE_SLUG_RE);
  if (bare) return { owner: bare[1], repo: bare[2] };
  return null;
}

/** True when the raw input (URL or slug) resolves to a free demo repo. */
export function isDemoRepoInput(input: string): boolean {
  const parsed = extractRepoSlug(input);
  return parsed !== null && matchesDemoRepo(parsed.owner, parsed.repo);
}
