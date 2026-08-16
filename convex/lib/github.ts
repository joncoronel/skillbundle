/**
 * Shared GitHub API helpers used by both github.ts (tech detection)
 * and skills.ts (skill content discovery).
 */

/**
 * Build auth + user-agent headers for GitHub API requests.
 * Pass a user OAuth token to act on the user's behalf (private repos);
 * otherwise the app-wide GITHUB_TOKEN is used.
 */
export function githubHeaders(userToken?: string): Record<string, string> {
  const token = userToken ?? process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "SkillBundle",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// GitHub owner/repo names are limited to [A-Za-z0-9._-]. Validate any
// source-derived "owner/repo" before interpolating it into an api.github.com
// URL: reject "."/".." segments (which would traverse the API path) and any
// out-of-charset character (?, #, %, …). The host is hardcoded so this can't
// reach a different host, but a malformed skills.sh `source` shouldn't be able
// to alter the request path either. Defense in depth — `isGitHubSource` only
// checks slash count + a dot-free owner, so it lets `owner/..` etc. through.
const REPO_SEGMENT = /^[A-Za-z0-9._-]+$/;
function isSafeRepoSegment(segment: string): boolean {
  return segment !== "." && segment !== ".." && REPO_SEGMENT.test(segment);
}
/** True when `path` is a safe "owner/repo": two clean GitHub path segments. */
export function isSafeRepoPath(path: string): boolean {
  const parts = path.split("/");
  return parts.length === 2 && parts.every(isSafeRepoSegment);
}

/** Resolve the default branch for a GitHub repo, falling back to "main". */
export async function resolveDefaultBranch(
  owner: string,
  repo: string,
): Promise<string> {
  const meta = await fetchRepoMetadata(owner, repo);
  return meta?.defaultBranch ?? "main";
}

export interface RepoMetadata {
  defaultBranch: string;
  description: string | null;
  topics: string[];
  /** GitHub's visibility flag — false means publicly fetchable. */
  private: boolean;
}

/**
 * Fetch the GitHub repo metadata (default branch, description, topics) in a
 * single REST call. Returns null if the repo doesn't exist or the API errors.
 */
export async function fetchRepoMetadata(
  owner: string,
  repo: string,
  token?: string,
): Promise<RepoMetadata | null> {
  if (!isSafeRepoPath(`${owner}/${repo}`)) return null;
  const headers = githubHeaders(token);
  // Topics require the mercy preview header on older APIs, but the v3 endpoint
  // returns them by default now. Belt-and-suspenders.
  headers.Accept = "application/vnd.github.mercy-preview+json";
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      default_branch: string;
      description: string | null;
      topics?: string[];
      private?: boolean;
    };
    return {
      defaultBranch: data.default_branch,
      description: data.description,
      topics: data.topics ?? [],
      private: data.private === true,
    };
  } catch {
    return null;
  }
}

export type RepoIdentityResult =
  | { status: "ok"; repoId: number; liveName: string }
  | { status: "not_found" } // 404 — deleted/private; cache as unresolvable
  | { status: "rate_limited" } // 403/429 — don't cache, retry later
  | { status: "error" }; // transient — don't cache, retry later

/**
 * Resolve a repo's stable GitHub id + current canonical "owner/repo".
 *
 * `fetch` follows the 301 a renamed repo returns, so `full_name` is always the
 * LIVE name even when `repo` is an old alias (e.g. resolving "qu-skills/skills"
 * yields id 1146509126, full_name "inference-sh/skills"). The stable id is what
 * lets us tell aliases of one repo (same id) from genuine forks (same content,
 * different id).
 */
export async function resolveRepoIdentity(
  repo: string,
): Promise<RepoIdentityResult> {
  // Malformed/unsafe path: treat as unresolvable so it caches as the no-id
  // sentinel and isn't retried (rather than hitting a traversed API path).
  if (!isSafeRepoPath(repo)) return { status: "not_found" };
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: githubHeaders(),
    });
    if (res.status === 404) return { status: "not_found" };
    if (res.status === 403 || res.status === 429)
      return { status: "rate_limited" };
    if (!res.ok) return { status: "error" };
    const data = (await res.json()) as { id?: unknown; full_name?: unknown };
    if (typeof data.id !== "number" || typeof data.full_name !== "string") {
      return { status: "error" };
    }
    return { status: "ok", repoId: data.id, liveName: data.full_name };
  } catch {
    return { status: "error" };
  }
}

export interface TreeEntry {
  path: string;
  type: string; // "blob" | "tree"
  /**
   * Git's object id for this blob: SHA-1 over `"blob " + size + "\0" + contents`.
   *
   * GitHub returns this for every entry in the recursive tree response, so it
   * costs nothing extra — we were already receiving it and discarding it by
   * declaring a narrower type than the payload. It is the cheap way to learn
   * that a SKILL.md moved: one conditional tree call per REPO answers for every
   * skill in it, instead of downloading each file to hash it.
   *
   * NOT comparable to `skills.syncHash`, which is our SHA-256 over the raw text.
   * Different algorithm, different preimage. Store and compare it only against
   * itself.
   *
   * Optional because `indexSkillMds` and the placement planners accept
   * hand-built entry lists in tests, and because a `tree`-type entry's sha
   * identifies a subtree rather than a file.
   */
  sha?: string;
}

export interface TreeResult {
  entries: TreeEntry[];
  truncated: boolean;
  branch: string;
  etag?: string;
}

/** Sentinel value returned when a conditional request gets 304 Not Modified. */
export const NOT_MODIFIED = "not_modified" as const;
export type NotModified = typeof NOT_MODIFIED;

/**
 * Sentinel for "GitHub cut us off", distinct from "this repo has no tree".
 *
 * Both used to return null, which made an exhausted rate-limit budget
 * indistinguishable from a quiet day: every remaining repo in the walk was
 * skipped silently and the run still logged success with a low flagged count.
 * Because the walk order is a stable cursor order, that starved the SAME tail
 * of the catalog on every recurrence.
 */
export const RATE_LIMITED = "rate_limited" as const;
export type RateLimited = typeof RATE_LIMITED;

/**
 * Fetch the recursive file tree for a repo.
 * Tries branches in priority order (pass the default branch first).
 *
 * When `options.etag` is provided, sends `If-None-Match` for the first branch.
 * Returns `NOT_MODIFIED` on 304 (cache is still valid, no rate limit cost).
 * Returns `RATE_LIMITED` when GitHub refuses on quota — callers should stop,
 * not continue, because every subsequent request will fail the same way.
 * Returns null if the tree cannot be fetched for a reason specific to this repo
 * (404, 409 too large).
 */
export async function fetchRepoTree(
  owner: string,
  repo: string,
  branches: string[],
  options?: { etag?: string; token?: string },
): Promise<TreeResult | NotModified | RateLimited | null> {
  if (!isSafeRepoPath(`${owner}/${repo}`)) return null;
  const baseHeaders = githubHeaders(options?.token);

  for (const branch of branches) {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
    const reqHeaders = { ...baseHeaders };

    // Only send If-None-Match for the first branch (etag is branch-specific)
    if (options?.etag && branch === branches[0]) {
      reqHeaders["If-None-Match"] = options.etag;
    }

    try {
      const res = await fetch(url, { headers: reqHeaders });

      if (res.status === 304) {
        return NOT_MODIFIED;
      }

      if (res.ok) {
        const data = (await res.json()) as {
          tree: TreeEntry[];
          truncated: boolean;
        };
        const responseEtag = res.headers.get("etag") ?? undefined;
        return {
          entries: data.tree,
          truncated: data.truncated,
          branch,
          etag: responseEtag,
        };
      }
      if (res.status === 404) continue;
      if (res.status === 409) {
        console.log(`Tree API 409 (too large) for ${owner}/${repo}/${branch}`);
        return null;
      }
      // Rate limited — log details and bail. Distinct from null: the caller
      // must stop the whole walk, not skip this repo and keep burning requests.
      if (res.status === 403 || res.status === 429) {
        const retryAfter = res.headers.get("retry-after");
        const remaining = res.headers.get("x-ratelimit-remaining");
        const resetEpoch = res.headers.get("x-ratelimit-reset");
        console.error(
          `GitHub rate limit hit for ${owner}/${repo}: ` +
            `status=${res.status}, remaining=${remaining}, ` +
            `retry-after=${retryAfter}, reset=${resetEpoch}`,
        );
        return RATE_LIMITED;
      }
      console.error(`Tree API ${res.status} for ${owner}/${repo}/${branch}`);
    } catch (e) {
      console.error(`Tree API fetch error for ${owner}/${repo}/${branch}:`, e);
      continue;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// raw.githubusercontent helpers + SKILL.md tree indexing
//
// These live here rather than in skills.ts / githubOnly.ts because those two
// modules' entire safety argument is that they resolve the SAME file for the
// same slug. Expressing the folder rule twice is what let their fast path and
// their tree walk drift apart; one definition removes the class.
// ---------------------------------------------------------------------------

/** The raw URL for a path in a repo. One template, so no caller re-spells it. */
export function rawGitHubUrl(
  source: string,
  branch: string,
  path: string,
): string {
  return `https://raw.githubusercontent.com/${source}/${branch}/${path}`;
}

/**
 * GET a raw URL, reporting null for anything that isn't a 200 body.
 *
 * A network throw is a miss rather than an exception, so one dead file can't
 * abort a whole repo's discovery.
 */
export async function fetchRawText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/**
 * A SKILL.md's frontmatter `name`, by the LOOSE rule discovery has always used:
 * the first `name:` line anywhere in the file, quotes stripped.
 *
 * Deliberately not `extractSkillMdName` (skills.ts), which requires a real
 * `---` fence. That one is right for the resolver and the audit, which ask "what
 * does this file declare itself to be?" about a file they are about to trust.
 * Discovery asks the same question of ~16k existing rows, and tightening it
 * would unbind every fence-less file that binds today — a catalog-wide content
 * change smuggled in as a cleanup. Both passes of discovery use THIS one, so the
 * two at least agree with each other.
 */
export function parseSkillMdName(body: string): string | null {
  const m = body.match(/^name:\s*(.+)$/m);
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

/**
 * Every SKILL.md in a repo tree, plus a containing-folder-name → path map.
 *
 * `byDir` is what answers "does a folder of this name hold this exact file?".
 * Keyed on the immediate parent only, and LAST ENTRY WINS on a duplicate leaf
 * name — both callers depend on the identical keying, which is why this is one
 * function and not two.
 */
export function indexSkillMds(
  entries: { type: string; path: string; sha?: string }[],
): {
  candidates: string[];
  byDir: Map<string, string>;
  /**
   * path → git blob sha, for the SKILL.md candidates only.
   *
   * Kept as a third return rather than folded into `byDir` so the existing two
   * keep their exact shapes — both callers depend on that identical keying, and
   * this function is one function specifically to stop them drifting.
   */
  shaByPath: Map<string, string>;
} {
  const candidates: string[] = [];
  const byDir = new Map<string, string>();
  const shaByPath = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type !== "blob") continue;
    const lower = entry.path.toLowerCase();
    if (lower !== "skill.md" && !lower.endsWith("/skill.md")) continue;
    candidates.push(entry.path);
    const parts = entry.path.split("/");
    if (parts.length >= 2) byDir.set(parts[parts.length - 2], entry.path);
    if (entry.sha) shaByPath.set(entry.path, entry.sha);
  }
  return { candidates, byDir, shaByPath };
}
