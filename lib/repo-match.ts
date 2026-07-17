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

/**
 * Code carried by the ConvexError that analyzeRepo throws when the plan gate
 * rejects a repo. Lives here (not in the Convex module) so the client can match
 * on it without importing server code. Thrown rather than returned so the
 * rejection is stored as a query error, never as cacheable data.
 */
export const PRO_REQUIRED = "pro_required" as const;

// Lowercased `owner/repo` slugs anyone can analyze for free.
const DEMO_REPO_SLUGS: ReadonlySet<string> = new Set([EXAMPLE_REPO_SLUG]);

/** True when this owner/repo is on the free demo allowlist (case-insensitive). */
export function matchesDemoRepo(owner: string, repo: string): boolean {
  return DEMO_REPO_SLUGS.has(`${owner.toLowerCase()}/${repo.toLowerCase()}`);
}

// GitHub owner/repo names are [A-Za-z0-9._-] — the same charset the server's
// isSafeRepoPath (convex/lib/github.ts REPO_SEGMENT) enforces, so "repo-shaped"
// here can't be looser than what the server accepts. Both patterns are anchored
// at the start (host match stays case-insensitive): an anchored, charset-bound
// pattern rejects a repo link buried in prose, a look-alike host like
// `mygithub.com/a/b`, and a URL missing its repo segment (`github.com/owner`) —
// all of which an unanchored `[^/]+` pattern would wave through.
const GITHUB_URL_RE =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)/i;
const BARE_SLUG_RE = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/;

// "."/".." pass the charset but are path-unsafe (they'd traverse the API path);
// isSafeRepoPath rejects them server-side, so reject them here too.
function toRepo(
  owner: string,
  repo: string,
): { owner: string; repo: string } | null {
  const unsafe = (s: string) => s === "." || s === "..";
  if (unsafe(owner) || unsafe(repo)) return null;
  return { owner, repo };
}

/**
 * Extract `{ owner, repo }` from a GitHub URL or a bare `owner/repo` slug.
 * This is THE canonical parser: `convex/recommendations.ts` and the composer's
 * repo-shape check both call it, so the server, the demo allowlist, and input
 * validation can never disagree. Returns null when the input isn't repo-shaped.
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
  if (url) return toRepo(url[1], url[2]);

  // A github.com-looking input that didn't match the anchored URL form is a
  // malformed URL, not a bare slug — don't salvage it as owner="github.com".
  if (/github\.com/i.test(cleaned)) return null;

  const bare = cleaned.match(BARE_SLUG_RE);
  if (bare) return toRepo(bare[1], bare[2]);
  return null;
}

/**
 * The one gate both sides call: repo match is allowed when the repo is on the
 * free demo allowlist OR the plan grants auto-detection. Server (with the
 * resolved plan) and client (with the subscribed plan) share this so the
 * policy — and the eventual phase-2 quota — lives in exactly one place.
 */
export function isRepoMatchAllowed(
  limits: { canAutoDetect: boolean },
  owner: string,
  repo: string,
): boolean {
  return matchesDemoRepo(owner, repo) || limits.canAutoDetect;
}
