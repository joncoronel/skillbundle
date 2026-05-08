"use client";

import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { StarIcon } from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/cubby-ui/button";
import { toast } from "@/components/ui/cubby-ui/toast/toast";
import { cn } from "@/lib/utils";

interface Props {
  bundleId: Id<"bundles">;
  starred: boolean;
  count: number;
  // Resolved server-side from the JWT cookie and passed down. Avoids the
  // client-side useConvexAuth() loading window that could otherwise bounce
  // a signed-in user to /sign-in if they click during the first ~100ms.
  isAuthenticated: boolean;
}

export function StarButton({
  bundleId,
  starred,
  count,
  isAuthenticated,
}: Props) {
  const router = useRouter();

  // Optimistic update for the detail page only. Other surfaces (Featured
  // showcase, search results, explore grid) reconcile via Convex's
  // subscription when the user navigates back. Brief stale flashes are
  // possible there but acceptable — stars only ever toggle from this page.
  //
  // Each row's direction is computed from the localStore value (which already
  // reflects any previous optimistic update), NOT from the closure-captured
  // `starred` prop. Otherwise rapid double-clicks before React re-renders
  // would both compute the same direction and the UI wouldn't toggle back.
  const toggleStar = useMutation(
    api.bundleStars.toggleStar,
  ).withOptimisticUpdate((localStore, { bundleId: bId }) => {
    for (const { args, value } of localStore.getAllQueries(
      api.bundles.getByUrlId,
    )) {
      if (value && value._id === bId) {
        const nextStarred = !value.viewerHasStarred;
        const delta = nextStarred ? 1 : -1;
        localStore.setQuery(api.bundles.getByUrlId, args, {
          ...value,
          viewerHasStarred: nextStarred,
          starCount: Math.max(0, value.starCount + delta),
        });
      }
    }
  });

  const handleClick = async () => {
    if (!isAuthenticated) {
      // Preserve the bundle URL so the user lands back here after sign-in
      // instead of bouncing to /. Mirrors what the proxy does for hard nav.
      const path = window.location.pathname + window.location.search;
      router.push(`/sign-in?redirect_url=${encodeURIComponent(path)}`);
      return;
    }
    try {
      await toggleStar({ bundleId });
    } catch (e) {
      toast.error({ title: "Couldn't update star" });
      console.error(e);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      aria-pressed={starred}
      leftSection={
        <HugeiconsIcon
          icon={StarIcon}
          strokeWidth={2}
          aria-hidden
          className={cn(
            "size-3.5 transition-colors duration-200 ease-out motion-reduce:transition-none",
            starred ? "fill-primary text-primary" : "text-current",
          )}
        />
      }
    >
      <span className="inline-flex items-center gap-1.5">
        {starred ? "Starred" : "Star"}
        <span className="font-mono tabular-nums text-muted-foreground">
          {count}
        </span>
      </span>
    </Button>
  );
}
