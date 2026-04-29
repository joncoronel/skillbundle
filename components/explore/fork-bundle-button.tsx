"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useConvexAuth } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { HugeiconsIcon } from "@hugeicons/react";
import { GitForkIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/cubby-ui/button";
import { useUserPlan } from "@/hooks/use-user-plan";
import { toast } from "@/components/ui/cubby-ui/toast/toast";

interface ForkBundleButtonProps {
  bundleId: Id<"bundles">;
  className?: string;
}

export function ForkBundleButton({
  bundleId,
  className,
}: ForkBundleButtonProps) {
  const { isAuthenticated } = useConvexAuth();
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
      router.push("/sign-in");
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
      router.push(`/stack/${result.urlId}`);
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
