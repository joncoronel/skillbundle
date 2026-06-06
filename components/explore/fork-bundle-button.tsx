"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { HugeiconsIcon } from "@hugeicons/react";
import { GitForkIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/cubby-ui/button";
import { useUserPlan } from "@/hooks/use-user-plan";
import { toast } from "@/components/ui/cubby-ui/toast/toast";

interface ForkBundleButtonProps {
  bundleId: Id<"bundles">;
  // Resolved server-side from the JWT cookie and passed down. Avoids the
  // client-side useConvexAuth() loading window that could otherwise bounce
  // a signed-in user to /sign-in if they click during the first ~100ms.
  isAuthenticated: boolean;
  className?: string;
}

export function ForkBundleButton({
  bundleId,
  isAuthenticated,
  className,
}: ForkBundleButtonProps) {
  const router = useRouter();
  const forkBundle = useMutation(api.bundles.forkBundle);
  const [forking, setForking] = useState(false);
  const { limits } = useUserPlan();
  const bundleCount = useQuery(
    api.bundles.countByUser,
    isAuthenticated ? {} : "skip",
  );

  async function handleFork() {
    if (!isAuthenticated) {
      // Preserve the bundle URL so the user lands back here after sign-in
      // instead of bouncing to /. Mirrors what the proxy does for hard nav.
      const path = window.location.pathname + window.location.search;
      router.push(`/sign-in?redirect_url=${encodeURIComponent(path)}`);
      return;
    }

    if (
      limits &&
      bundleCount !== undefined &&
      bundleCount >= limits.maxBundles
    ) {
      toast.error({
        title: "Bundle limit reached",
        description: `You've used all ${limits.maxBundles} bundles. Upgrade to Pro for unlimited bundles.`,
      });
      return;
    }

    setForking(true);
    try {
      const result = await forkBundle({ bundleId });
      router.push(`/bundle/${result.urlId}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to fork bundle";
      toast.error({ title: "Cannot fork bundle", description: message });
    } finally {
      setForking(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleFork}
      loading={forking}
      className={className}
      leftSection={<HugeiconsIcon icon={GitForkIcon} strokeWidth={2} className="size-3.5" />}
    >
      {forking ? "Forking…" : "Fork"}
    </Button>
  );
}
