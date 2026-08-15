/**
 * Retrieve a user's GitHub OAuth access token from Clerk's Backend API.
 *
 * Clerk stores and refreshes the token for connected external accounts; we
 * fetch it on demand and never persist it. Plain fetch (no @clerk/backend) so
 * this stays in Convex's default runtime.
 */

export type GithubTokenResult =
  | { status: "not_connected" }
  | { status: "missing_scope"; token: string }
  | { status: "connected"; token: string; scopes: string[] };

/** Scope required to list and read the user's private repos. */
export const GITHUB_REPO_SCOPE = "repo";

function normalizeScopes(raw: unknown): string[] {
  if (Array.isArray(raw))
    return raw.filter((s): s is string => typeof s === "string");
  if (typeof raw === "string") return raw.split(/[\s,]+/).filter(Boolean);
  return [];
}

/**
 * Returns the token result, or null on Clerk/config errors (missing
 * CLERK_SECRET_KEY, 5xx) — callers must treat null as transient failure,
 * NOT as "not connected".
 */
export async function getGithubOauthToken(
  clerkUserId: string,
): Promise<GithubTokenResult | null> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    console.error("CLERK_SECRET_KEY is not set in the Convex environment");
    return null;
  }
  try {
    const res = await fetch(
      `https://api.clerk.com/v1/users/${encodeURIComponent(clerkUserId)}/oauth_access_tokens/oauth_github?paginated=true`,
      { headers: { Authorization: `Bearer ${secretKey}` } },
    );
    if (res.status === 404) return { status: "not_connected" };
    if (!res.ok) {
      console.error(`Clerk oauth_access_tokens API error: ${res.status}`);
      return null;
    }
    const body = (await res.json()) as
      | { data?: Array<{ token?: string; scopes?: unknown }> }
      | Array<{ token?: string; scopes?: unknown }>;
    const entry = Array.isArray(body) ? body[0] : body.data?.[0];
    if (!entry?.token) return { status: "not_connected" };
    const scopes = normalizeScopes(entry.scopes);
    return scopes.includes(GITHUB_REPO_SCOPE)
      ? { status: "connected", token: entry.token, scopes }
      : { status: "missing_scope", token: entry.token };
  } catch (e) {
    console.error("Clerk oauth_access_tokens fetch failed:", e);
    return null;
  }
}
