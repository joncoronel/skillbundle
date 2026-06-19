"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/cubby-ui/button";
import {
  ButtonGroup,
  ButtonGroupText,
} from "@/components/ui/cubby-ui/button-group";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { useBundleActions, useIsSkillSelected } from "@/lib/bundle-selection";
import { useHydrated } from "@/hooks/use-hydrated";

export function BundleToggleButton({
  source,
  skillId,
  name,
}: {
  source: string;
  skillId: string;
  name: string;
}) {
  const isSelected = useIsSkillSelected(source, skillId);
  const { toggleSkill } = useBundleActions();
  const hydrated = useHydrated();
  const toggle = () => toggleSkill({ source, skillId, name });

  if (!hydrated) {
    return <Skeleton className="h-9 w-full rounded-lg sm:h-8" />;
  }

  if (!isSelected) {
    return (
      <Button variant="primary" size="sm" className="w-full" onClick={toggle}>
        Add to bundle
      </Button>
    );
  }

  // In-bundle is a status, not an action: plain text confirmation with a
  // separate, explicit remove button beside it.
  return (
    <ButtonGroup className="w-full">
      <ButtonGroupText className="h-9 flex-1 justify-center text-muted-foreground sm:h-8">
        <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="size-4" />
        In bundle
      </ButtonGroupText>
      <Button
        variant="outline"
        size="icon_sm"
        aria-label={`Remove ${name} from bundle`}
        onClick={toggle}
        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <HugeiconsIcon
          icon={Cancel01Icon}
          strokeWidth={2}
          className="size-3.5"
        />
      </Button>
    </ButtonGroup>
  );
}
