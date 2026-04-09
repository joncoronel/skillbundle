"use client";

import { useRef } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import Markdown from "react-markdown";
import { api } from "@/convex/_generated/api";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/cubby-ui/sheet";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, PlusSignIcon, MinusSignIcon } from "@hugeicons/core-free-icons";
import { Button, buttonVariants } from "@/components/ui/cubby-ui/button";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton";
import { useBundleSelection } from "@/lib/bundle-selection-context";
import { formatInstalls } from "@/lib/utils";
import type { SkillData } from "@/components/skill-card";

interface SkillDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skill: SkillData | null;
}

export function SkillDetailSheet({
  open,
  onOpenChange,
  skill,
}: SkillDetailSheetProps) {
  // Keep the last non-null skill so content stays visible during exit animation
  const displaySkillRef = useRef<SkillData | null>(null);
  if (skill) {
    displaySkillRef.current = skill;
  }
  const shownSkill = skill ?? displaySkillRef.current;

  const { data: content, isPending: contentLoading } = useQuery(
    convexQuery(
      api.skills.getContent,
      shownSkill
        ? { source: shownSkill.source, skillId: shownSkill.skillId }
        : "skip",
    ),
  );

  const selection = useBundleSelection();
  const isSelected =
    shownSkill && selection
      ? selection.isSelected(shownSkill.source, shownSkill.skillId)
      : false;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" variant="floating" className="sm:max-w-lg">
        {shownSkill && (
          <>
            <SheetHeader>
              <SheetTitle className="font-display">{shownSkill.name}</SheetTitle>
              <SheetDescription>
                <span className="tabular-nums">
                  {formatInstalls(shownSkill.installs)} installs
                </span>
                {" · "}
                <a
                  href={`https://github.com/${shownSkill.source}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  {shownSkill.source}
                </a>
              </SheetDescription>
            </SheetHeader>
            <SheetBody>
              {contentLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : content ? (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  {shownSkill.description && (
                    <p className="lead text-muted-foreground">
                      {shownSkill.description}
                    </p>
                  )}
                  <Markdown>{content}</Markdown>
                </div>
              ) : shownSkill.description ? (
                <p className="text-sm text-muted-foreground">
                  {shownSkill.description}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No detailed content available for this skill.
                </p>
              )}
            </SheetBody>
            <SheetFooter>
              <Link
                href={`/${shownSkill.source}/${shownSkill.skillId}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                View full page
                <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3.5" />
              </Link>
              {selection && (
                <Button
                  variant={isSelected ? "outline" : "primary"}
                  size="sm"
                  leftSection={<HugeiconsIcon icon={isSelected ? MinusSignIcon : PlusSignIcon} strokeWidth={2} className="size-3.5" />}
                  onClick={() =>
                    selection.toggleSkill({
                      source: shownSkill.source,
                      skillId: shownSkill.skillId,
                      name: shownSkill.name,
                    })
                  }
                >
                  {isSelected ? "Remove from bundle" : "Add to bundle"}
                </Button>
              )}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
