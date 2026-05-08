"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { StarIcon } from "@hugeicons/core-free-icons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/cubby-ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/cubby-ui/tooltip";
import { toast } from "@/components/ui/cubby-ui/toast/toast";
import { cn } from "@/lib/utils";

interface Props {
  bundleId: Id<"bundles">;
  isPublic: boolean;
  featuredAt: number | undefined;
}

// Caller is expected to gate rendering on `viewerIsAdmin`. Combined with the
// dynamic import on the call site, this component never loads or mounts for
// non-admins, so there's no internal admin check.
export function FeatureToggleButton({
  bundleId,
  isPublic,
  featuredAt,
}: Props) {
  const setFeatured = useMutation(api.bundles.setBundleFeatured);
  const [pending, setPending] = useState(false);

  const featured = typeof featuredAt === "number";
  // Block *new* featuring on private bundles, but always allow unfeaturing —
  // admins should be able to remove a featured pin from a bundle whose owner
  // has flipped private, without having to navigate to the /dev section.
  const disabled = !featured && !isPublic;

  const handleClick = async () => {
    setPending(true);
    try {
      await setFeatured({ bundleId, featured: !featured });
      toast.info({
        title: featured
          ? "Removed from featured"
          : "Featured. Visible on Explore.",
      });
    } catch (e) {
      toast.error({ title: "Couldn't update featured status" });
      console.error(e);
    } finally {
      setPending(false);
    }
  };

  const star = (
    <HugeiconsIcon
      icon={StarIcon}
      strokeWidth={2}
      aria-hidden
      className={cn(
        "size-3.5 transition-colors duration-200 ease-out motion-reduce:transition-none",
        featured && !disabled ? "fill-primary text-primary" : "text-current",
      )}
    />
  );

  const button = (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={disabled}
      loading={pending}
      aria-pressed={featured}
      leftSection={star}
    >
      {featured ? "Featured" : "Feature"}
    </Button>
  );

  if (!disabled) return button;

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        {button}
      </TooltipTrigger>
      <TooltipContent className="max-w-56">
        Make this bundle public to feature it on Explore.
      </TooltipContent>
    </Tooltip>
  );
}
