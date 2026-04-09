/**
 * Shared GitHub API helpers used by both github.ts (tech detection)
 * and skills.ts (skill content discovery).
 */

/** Build auth + user-agent headers for GitHub API requests. */
export function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "SkillStack",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
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
}

/**
 * Fetch the GitHub repo metadata (default branch, description, topics) in a
 * single REST call. Returns null if the repo doesn't exist or the API errors.
 */
export async function fetchRepoMetadata(
  owner: string,
  repo: string,
): Promise<RepoMetadata | null> {
  const headers = githubHeaders();
  // Topics require the mercy preview header on older APIs, but the v3 endpoint
  // returns them by default now. Belt-and-suspenders.
  headers.Accept = "application/vnd.github.mercy-preview+json";
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      default_branch: string;
      description: string | null;
      topics?: string[];
    };
    return {
      defaultBranch: data.default_branch,
      description: data.description,
      topics: data.topics ?? [],
    };
  } catch {
    return null;
  }
}

export interface TreeEntry {
  path: string;
  type: string; // "blob" | "tree"
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
 * Fetch the recursive file tree for a repo.
 * Tries branches in priority order (pass the default branch first).
 *
 * When `options.etag` is provided, sends `If-None-Match` for the first branch.
 * Returns `NOT_MODIFIED` on 304 (cache is still valid, no rate limit cost).
 * Returns null if the tree cannot be fetched (404, 409 too large, rate limit).
 */
export async function fetchRepoTree(
  owner: string,
  repo: string,
  branches: string[],
  options?: { etag?: string },
): Promise<TreeResult | NotModified | null> {
  const baseHeaders = githubHeaders();

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
        console.log(
          `Tree API 409 (too large) for ${owner}/${repo}/${branch}`,
        );
        return null;
      }
      // Rate limited — log details and bail
      if (res.status === 403 || res.status === 429) {
        const retryAfter = res.headers.get("retry-after");
        const remaining = res.headers.get("x-ratelimit-remaining");
        const resetEpoch = res.headers.get("x-ratelimit-reset");
        console.error(
          `GitHub rate limit hit for ${owner}/${repo}: ` +
            `status=${res.status}, remaining=${remaining}, ` +
            `retry-after=${retryAfter}, reset=${resetEpoch}`,
        );
        return null;
      }
      console.error(
        `Tree API ${res.status} for ${owner}/${repo}/${branch}`,
      );
    } catch (e) {
      console.error(
        `Tree API fetch error for ${owner}/${repo}/${branch}:`,
        e,
      );
      continue;
    }
  }
  return null;
}
