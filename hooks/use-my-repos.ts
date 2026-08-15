"use client";

import { useQuery } from "@tanstack/react-query";
import { useConvex, useConvexAuth } from "convex/react";
import { ConvexError } from "convex/values";
import { useUser } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";
import type { ListMyReposResult, MyRepo } from "@/convex/githubAccount";
import { useUserPlan } from "@/hooks/use-user-plan";
import { PRO_REQUIRED } from "@/lib/repo-match";

/**
 * The user's GitHub connection state + their repo list, shared by the
 * composer's repo suggestions and the empty state's connect CTAs so both
 * read one query cache and can never disagree.
 *
 * Client-side detection (account, scopes) routes the initial render; the
 * server's status — which reads the actual stored token — overrides it once
 * the query resolves.
 */
export function useMyRepos() {
  const convex = useConvex();
  const { user } = useUser();
  const { isAuthenticated } = useConvexAuth();
  const { limits, isLoading: planLoading, isPlanError } = useUserPlan();
  const isPro = limits?.canAutoDetect ?? false;
  // Resolved-free, mirroring repo-url-input's knownLocked: loading or errored
  // plans are "unknown", never "free".
  const knownFree = !planLoading && !isPlanError && !isPro;

  const account = user?.externalAccounts?.find(
    (a) => a.provider === "github" && a.verification?.status === "verified",
  );
  // A connect attempt Clerk rejected leaves an UNVERIFIED github record
  // carrying the rejection (e.g. oauth_identification_claimed when the GitHub
  // account's email belongs to a different SkillBundle user).
  const failedAccount = account
    ? undefined
    : user?.externalAccounts?.find(
        (a) => a.provider === "github" && a.verification?.error,
      );
  // approvedScopes is a space-delimited string on Clerk's ExternalAccount.
  const hasRepoScope = (account?.approvedScopes ?? "")
    .split(/[\s,]+/)
    .includes("repo");

  const {
    data: result,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery<ListMyReposResult>({
    queryKey: ["github", "myRepos", user?.id],
    queryFn: () => convex.action(api.githubAccount.listMyRepos, {}),
    // Fire as soon as auth is ready (JWT attached) + the connection looks
    // usable client-side — NOT once the plan query resolves. Same optimistic
    // pattern as analyzeRepo's canFetch: the server is the authoritative Pro
    // gate, so waiting for the plan here would serialize a full round trip
    // in front of the repo fetch on every cold load. Only a resolved-free
    // plan disables it (their PRO_REQUIRED rejection is filtered below).
    enabled:
      isAuthenticated && !!user && !!account && hasRepoScope && !knownFree,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
  });

  // A free user's optimistic fetch gets the server's PRO_REQUIRED throw —
  // that's the gate working, not a load failure; don't surface it as one.
  const proRequired =
    error instanceof ConvexError &&
    (error.data as { code?: string } | undefined)?.code === PRO_REQUIRED;

  const repos: MyRepo[] = result?.status === "ok" ? result.repos : [];

  return {
    account,
    failedAccount,
    hasRepoScope,
    isPro,
    /** Server-verified status; undefined until the query resolves. */
    serverStatus: result?.status,
    repos,
    reposPending: isPending,
    reposError: isError && !proRequired,
    refetchRepos: refetch,
  };
}
