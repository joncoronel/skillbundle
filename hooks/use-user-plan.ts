"use client";

import { useConvexAuth } from "convex/react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import type { Plan } from "@/lib/plans";

export function useUserPlan() {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const { data: result, isPending } = useQuery({
    ...convexQuery(api.plans.currentPlan, isAuthenticated ? {} : "skip"),
    enabled: isAuthenticated,
  });

  return {
    plan: (result?.plan ?? "free") as Plan,
    limits: result?.limits ?? null,
    gatingEnabled: result?.gatingEnabled ?? false,
    isLoading: authLoading || (isAuthenticated && isPending),
  };
}
