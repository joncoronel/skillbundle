"use client";

import { useQuery } from "@tanstack/react-query";
import { useConvex } from "convex/react";
import { useUser } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";
import type { ListMyReposResult, MyRepo } from "@/convex/githubAccount";
import { useUserPlan } from "@/hooks/use-user-plan";

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
  const { user, isLoaded } = useUser();
  const { limits, isLoading: planLoading, isPlanError } = useUserPlan();
  const isPro = limits?.canAutoDetect ?? false;

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
    refetch,
  } = useQuery<ListMyReposResult>({
    queryKey: ["github", "myRepos", user?.id],
    queryFn: () => convex.action(api.githubAccount.listMyRepos, {}),
    enabled: isPro && !!user && !!account && hasRepoScope,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
  });

  const repos: MyRepo[] = result?.status === "ok" ? result.repos : [];

  return {
    user,
    isLoaded,
    account,
    failedAccount,
    hasRepoScope,
    isPro,
    /** Server-verified status; undefined until the query resolves. */
    serverStatus: result?.status,
    repos,
    reposPending: isPending,
    reposError: isError,
    refetchRepos: refetch,
  };
}
