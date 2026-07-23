/**
 * Per-user GitHub account actions — powered by the GitHub OAuth token Clerk
 * stores for the user's connected external account. Nothing here persists
 * tokens or repo lists; the client's query cache is the only cache.
 */
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { getGithubOauthToken } from "./lib/clerkGithub";
import { MAX_GITHUB_REPOS, PRO_REQUIRED } from "../lib/repo-match";

export interface MyRepo {
  /** "owner/repo" — directly usable as the repo-match input. */
  fullName: string;
  private: boolean;
  pushedAt: string | null;
  description: string | null;
  language: string | null;
}

export type ListMyReposResult =
  | { status: "not_connected" }
  | { status: "missing_scope" }
  /** GitHub rejected the stored token (revoked on github.com) — reconnect. */
  | { status: "token_invalid" }
  /** Transient Clerk/GitHub failure — safe to retry later. */
  | { status: "error" }
  | { status: "ok"; repos: MyRepo[] };

const PER_PAGE = 100;
const MAX_REPOS = MAX_GITHUB_REPOS;

interface GitHubRepoJson {
  full_name?: unknown;
  private?: unknown;
  pushed_at?: unknown;
  description?: unknown;
  language?: unknown;
}

function toMyRepo(r: GitHubRepoJson): MyRepo | null {
  if (typeof r.full_name !== "string") return null;
  return {
    fullName: r.full_name,
    private: r.private === true,
    pushedAt: typeof r.pushed_at === "string" ? r.pushed_at : null,
    description: typeof r.description === "string" ? r.description : null,
    language: typeof r.language === "string" ? r.language : null,
  };
}

/**
 * List the repos the signed-in user owns, newest-pushed first, using their
 * connected GitHub account. Pro-gated like the repo-match feature it feeds —
 * otherwise this would be a free "list my private repos" API.
 */
export const listMyRepos = action({
  args: {},
  returns: v.union(
    v.object({ status: v.literal("not_connected") }),
    v.object({ status: v.literal("missing_scope") }),
    v.object({ status: v.literal("token_invalid") }),
    v.object({ status: v.literal("error") }),
    v.object({
      status: v.literal("ok"),
      repos: v.array(
        v.object({
          fullName: v.string(),
          private: v.boolean(),
          pushedAt: v.union(v.string(), v.null()),
          description: v.union(v.string(), v.null()),
          language: v.union(v.string(), v.null()),
        }),
      ),
    }),
  ),
  handler: async (ctx): Promise<ListMyReposResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({ code: "unauthenticated" });
    }

    const { limits } = await ctx.runQuery(
      internal.plans.internalCurrentPlan,
      {},
    );
    if (!limits.canAutoDetect) {
      throw new ConvexError({ code: PRO_REQUIRED });
    }

    const tokenResult = await getGithubOauthToken(identity.subject);
    if (tokenResult === null) return { status: "error" };
    if (tokenResult.status === "not_connected")
      return { status: "not_connected" };
    // A token without the `repo` scope would silently list only public repos
    // — worse than an honest "grant private repo access" state.
    if (tokenResult.status === "missing_scope")
      return { status: "missing_scope" };

    const repos: MyRepo[] = [];
    let url: string | null =
      `https://api.github.com/user/repos?affiliation=owner&sort=pushed&per_page=${PER_PAGE}`;

    while (url && repos.length < MAX_REPOS) {
      let res: Response;
      try {
        res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${tokenResult.token}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "SkillBundle",
          },
        });
      } catch (e) {
        console.error("GitHub /user/repos fetch failed:", e);
        return { status: "error" };
      }
      if (res.status === 401) return { status: "token_invalid" };
      if (!res.ok) {
        console.error(`GitHub /user/repos error: ${res.status}`);
        return { status: "error" };
      }

      const page = (await res.json()) as unknown;
      if (!Array.isArray(page)) return { status: "error" };
      for (const raw of page) {
        const repo = toMyRepo(raw as GitHubRepoJson);
        if (repo) repos.push(repo);
        if (repos.length >= MAX_REPOS) break;
      }

      const link = res.headers.get("link") ?? "";
      const next = /<([^>]+)>;\s*rel="next"/.exec(link);
      url = next ? next[1] : null;
    }

    return { status: "ok", repos };
  },
});
