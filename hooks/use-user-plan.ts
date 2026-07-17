"use client";

import { useConvexAuth } from "convex/react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import type { Plan } from "@/lib/plans";

export function useUserPlan() {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const {
    data: result,
    isPending,
    isError,
  } = useQuery({
    ...convexQuery(api.plans.currentPlan, isAuthenticated ? {} : "skip"),
    enabled: isAuthenticated,
  });

  return {
    plan: (result?.plan ?? "free") as Plan,
    limits: result?.limits ?? null,
    gatingEnabled: result?.gatingEnabled ?? false,
    // Fully resolved: auth AND the plan query. Callers that only need the JWT
    // attached should watch `isAuthLoading` instead, so work can start in
    // parallel with the plan round-trip rather than serially after it.
    isLoading: authLoading || (isAuthenticated && isPending),
    isAuthLoading: authLoading,
    // Plan query failed (e.g. a websocket blip). Treat as "unknown", never
    // "free" — otherwise a Pro user gets gated with no way to recover.
    isPlanError: isAuthenticated && isError,
  };
}
