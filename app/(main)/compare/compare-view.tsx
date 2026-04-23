"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import Link from "next/link";
import Markdown from "react-markdown";
import { api } from "@/convex/_generated/api";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/cubby-ui/button";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsPanels,
  TabsContent,
} from "@/components/ui/cubby-ui/tabs";
import {
  useBundleActions,
  useIsSkillSelected,
} from "@/lib/bundle-selection";
import { formatInstalls } from "@/lib/utils";

interface SkillRef {
  source: string;
  skillId: string;
}

function parseSkillRefs(param: string | null): SkillRef[] {
  if (!param) return [];
  return param
    .split(",")
    .map((ref) => {
      // Format: owner/repo:skillId
      const colonIdx = ref.lastIndexOf(":");
      if (colonIdx === -1) return null;
      return {
        source: ref.slice(0, colonIdx),
        skillId: ref.slice(colonIdx + 1),
      };
    })
    .filter((r): r is SkillRef => r !== null);
}

function CompareColumn({ source, skillId }: SkillRef) {
  const { data: skill, isPending: skillLoading } = useQuery(
    convexQuery(api.skills.getBySourceAndSkillId, { source, skillId }),
  );
  const { data: content, isPending: contentLoading } = useQuery(
    convexQuery(api.skills.getContent, { source, skillId }),
  );
  const isSelected = useIsSkillSelected(source, skillId);
  const { toggleSkill } = useBundleActions();

  if (skillLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!skill) {
    return (
      <div className="text-sm text-muted-foreground">
        Skill not found: {source}/{skillId}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{skill.name}</h2>
        <p className="text-sm text-muted-foreground">
          <span className="tabular-nums">
            {formatInstalls(skill.installs)} installs
          </span>
          {" · "}
          <a
            href={`https://github.com/${skill.source}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {skill.source}
          </a>
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border p-4">
        {contentLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ) : content ? (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            {skill.description && (
              <p className="lead text-muted-foreground">{skill.description}</p>
            )}
            <Markdown>{content}</Markdown>
          </div>
        ) : skill.description ? (
          <p className="text-sm text-muted-foreground">{skill.description}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            No detailed content available.
          </p>
        )}
      </div>

      <Button
        variant={isSelected ? "outline" : "primary"}
        size="sm"
        onClick={() =>
          toggleSkill({
            source: skill.source,
            skillId: skill.skillId,
            name: skill.name,
          })
        }
      >
        {isSelected ? "Remove from bundle" : "Add to bundle"}
      </Button>
    </div>
  );
}

export function CompareView() {
  const searchParams = useSearchParams();
  const refs = parseSkillRefs(searchParams.get("skills"));

  if (refs.length < 2) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        <p className="text-lg font-medium">Select 2-3 skills to compare</p>
        <p className="mt-1 text-sm">
          Go back and select skills from the discovery page.
        </p>
        <Button
          variant="primary"
          className="mt-6"
          nativeButton={false}
          render={<Link href="/" />}
          leftSection={<HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} className="size-4" />}
        >
          Back to home
        </Button>
      </div>
    );
  }

  return (
    <>
      {/* Desktop: side-by-side columns */}
      <div className="hidden md:grid md:gap-6" style={{ gridTemplateColumns: `repeat(${Math.min(refs.length, 3)}, 1fr)` }}>
        {refs.slice(0, 3).map((ref) => (
          <CompareColumn
            key={`${ref.source}:${ref.skillId}`}
            source={ref.source}
            skillId={ref.skillId}
          />
        ))}
      </div>

      {/* Mobile: tabs */}
      <div className="md:hidden">
        <Tabs defaultValue={`${refs[0].source}:${refs[0].skillId}`}>
          <TabsList>
            {refs.slice(0, 3).map((ref) => (
              <TabsTrigger
                key={`${ref.source}:${ref.skillId}`}
                value={`${ref.source}:${ref.skillId}`}
              >
                {ref.skillId}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsPanels className="mt-4">
            {refs.slice(0, 3).map((ref) => (
              <TabsContent
                key={`${ref.source}:${ref.skillId}`}
                value={`${ref.source}:${ref.skillId}`}
              >
                <CompareColumn source={ref.source} skillId={ref.skillId} />
              </TabsContent>
            ))}
          </TabsPanels>
        </Tabs>
      </div>
    </>
  );
}
