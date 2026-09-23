// Repo-match policy: the demo allowlist, the free allowances, and the error
// codes a refusal carries.
//
// Repo match (GitHub auto-detection) is unlimited on Pro and metered for
// everyone else: signed-in free accounts get FREE_MONTHLY_REPOS distinct repos
// a month, signed-out visitors get ANON_DAILY_ANALYSES fresh analyses per IP
// (the day's allowance refills over 24h), and the demo allowlist runs free for
// everyone. Enforced server-side in convex/recommendations.ts (the monthly
// count lives in convex/repoMatchQuota.ts, the signed-out one in
// convex/rateLimits.ts); the client mirrors it to pick the right entry point
// and to skip round-trips it already knows will be refused.
//
// Shared by both the Convex backend (../lib/repo-match) and the client
// (@/lib/repo-match) so the two can never drift.

/**
 * Server-side cap on how many of the user's GitHub repos `listMyRepos`
 * returns (newest-pushed first). Shared here so client copy about the cap
 * can't drift from the server's actual limit.
 */
export const MAX_GITHUB_REPOS = 200;

/** The repo shown in the repo-mode empty state's "Try it" button. */
export const EXAMPLE_REPO_SLUG = "shadcn-ui/ui";
export const EXAMPLE_REPO_URL = `https://github.com/${EXAMPLE_REPO_SLUG}`;

/** The current UTC calendar month as "YYYY-MM": the free allowance's period. */
export function currentMonth(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 7);
}

/** Distinct repos a signed-in free account can match per calendar month (UTC). */
export const FREE_MONTHLY_REPOS = 5;

/**
 * Successful fresh (uncached) analyses a signed-out visitor gets per IP.
 * Errors don't count; they spend the daily attempt budget instead. A token
 * bucket of this size refilling over a day, so "per day" is rolling, not
 * midnight.
 */
export const ANON_DAILY_ANALYSES = 3;

// Codes carried by the ConvexErrors the repo-match gates throw. They live here
// (not in the Convex modules) so the client can match on them without
// importing server code. Thrown rather than returned so a refusal is stored as
// a query error, never as cacheable data that would pin a user to the wall
// after they upgrade or sign in.

/** A Pro-only feature was asked for on a free plan (the GitHub repo picker). */
export const PRO_REQUIRED = "pro_required" as const;
/** A free account has used its FREE_MONTHLY_REPOS for this month. */
export const FREE_LIMIT = "repo_match_free_limit" as const;
/** A signed-out visitor has used their ANON_DAILY_ANALYSES. */
export const ANON_LIMIT = "repo_match_anon_limit" as const;
/**
 * A signed-out call reached `analyzeRepo` directly for a non-demo repo.
 * Signed-out matching has to come through the site's server action, which is
 * the only place that can see the visitor's IP to meter it.
 */
export const SIGN_IN_REQUIRED = "repo_match_sign_in_required" as const;
/** The signed-out server action's BotID check refused the request. */
export const BOT_REFUSED = "repo_match_bot" as const;
/** Signed-out matching is misconfigured on this deployment (no secret). */
export const SIGNED_OUT_UNAVAILABLE = "repo_match_unavailable" as const;

/**
 * Every code the signed-out server action returns. Typed so the client's
 * mapping from code to prompt can't drift from what the action sends.
 */
export const SIGNED_OUT_CODES = [
  ANON_LIMIT,
  BOT_REFUSED,
  SIGNED_OUT_UNAVAILABLE,
  "rate_limited",
  "invalid_url",
  "failed",
] as const;
export type SignedOutCode = (typeof SIGNED_OUT_CODES)[number];

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
  // as repo `ui.git`, which would miss the allowlist and charge a demo run
  // against the caller's allowance.
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
 * Which allowance a repo match draws on:
 *
 * - `"none"`: nothing is counted (a demo repo, or a Pro plan).
 * - `"monthly"`: a signed-in free account's FREE_MONTHLY_REPOS.
 * - `"anonymous"`: a signed-out visitor's ANON_DAILY_ANALYSES, which only the
 *   site's server action can meter (it is keyed on the visitor's IP).
 *
 * The one policy predicate both sides call. The server (with the resolved
 * plan) enforces the meter it names; the client (with the subscribed plan)
 * uses it to route the request and to word the refusal, so the two can't
 * disagree about who is metered how.
 */
export type RepoMatchMeter = "none" | "monthly" | "anonymous";

export function repoMatchMeter(
  caller: { signedIn: boolean; canAutoDetect: boolean },
  owner: string,
  repo: string,
): RepoMatchMeter {
  if (matchesDemoRepo(owner, repo)) return "none";
  if (!caller.signedIn) return "anonymous";
  return caller.canAutoDetect ? "none" : "monthly";
}

/**
 * The key a repo is counted under: lowercased `owner/repo`. GitHub names are
 * case-insensitive, so every casing of one repo is one slot, and this matches
 * the cache key analyzeRepo builds.
 */
export function repoMatchKey(owner: string, repo: string): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}`;
}
