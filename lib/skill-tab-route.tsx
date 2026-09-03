import "server-only";
import type { Metadata } from "next";
import { Suspense } from "react";
import { DataErrorBoundary } from "@/components/data-error-boundary";
import {
  SkillHistoryTab,
  SkillHistoryTabSkeleton,
} from "@/components/skill-history-tab";
import {
  SkillStatsTab,
  SkillStatsTabSkeleton,
} from "@/components/skill-stats-tab";
import {
  SkillSecurityTab,
  SkillSecurityTabSkeleton,
} from "@/components/skill-security-tab";
import {
  SkillCopiesTab,
  SkillCopiesTabSkeleton,
} from "@/components/skill-copies-tab";
import { loadSkill } from "@/lib/skill-cache";
import { skillHref } from "@/lib/skill-urls";

/**
 * Everything the eight skill route files (four tabs x two route trees) have
 * in common, so each of them is a few lines: resolve `params` into a source,
 * call these. The trees differ only in how `params` becomes a source and in
 * the external-link props the Overview needs.
 */
export type SkillTab = "overview" | "history" | "stats" | "security" | "copies";

const TAB_COPY: Record<
  Exclude<SkillTab, "overview">,
  { suffix: string; description: (name: string) => string; errorLabel: string }
> = {
  history: {
    suffix: "history",
    description: (name) =>
      `Every change SkillBundle has recorded to ${name}'s skill file.`,
    errorLabel: "this skill's history",
  },
  stats: {
    suffix: "stats",
    description: (name) =>
      `Install count and daily install history for ${name}, recorded once a day.`,
    errorLabel: "this skill's stats",
  },
  security: {
    suffix: "security",
    description: (name) =>
      `Security audit verdicts for ${name} from skills.sh's audit partners.`,
    errorLabel: "this skill's security audits",
  },
  copies: {
    suffix: "copies",
    description: (name) =>
      `Every repo publishing ${name}'s content, ranked by install count.`,
    errorLabel: "this skill's copies",
  },
};

/**
 * Metadata for any skill tab. Sets `openGraph.images` explicitly, and that is
 * the reason this is one function: `openGraph` is replaced whole by the
 * deepest segment that sets it, and the file-convention image in
 * `[skillId]/opengraph-image.tsx` only auto-merges at its own segment. Every
 * tab page, and the Overview once it moved into the `(overview)` group, is a
 * deeper segment, so without this line their share links carry no image.
 * app/(main)/page.tsx documents the same trap for the root image.
 */
export async function skillTabMetadata(
  tab: SkillTab,
  source: string,
  skillId: string,
): Promise<Metadata> {
  const skill = await loadSkill(source, skillId);
  if (!skill) return { title: "Skill Not Found | SkillBundle" };

  const title =
    tab === "overview"
      ? `${skill.name} | SkillBundle`
      : `${skill.name} ${TAB_COPY[tab].suffix} | SkillBundle`;
  const description =
    tab === "overview"
      ? (skill.description ?? `${skill.name} — a skill from ${source}`)
      : TAB_COPY[tab].description(skill.name);

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      images: [
        {
          url: `${skillHref(source, skillId)}/opengraph-image`,
          width: 1200,
          height: 630,
          alt: `${skill.name} on SkillBundle`,
        },
      ],
    },
  };
}

type TabBody = (props: {
  source: string;
  skillId: string;
}) => Promise<React.ReactNode>;

const TAB_PARTS: Record<
  Exclude<SkillTab, "overview">,
  [TabBody, () => React.ReactNode]
> = {
  history: [SkillHistoryTab, SkillHistoryTabSkeleton],
  stats: [SkillStatsTab, SkillStatsTabSkeleton],
  security: [SkillSecurityTab, SkillSecurityTabSkeleton],
  copies: [SkillCopiesTab, SkillCopiesTabSkeleton],
};

/** The body of a non-Overview tab page: boundary, skeleton, and the tab. */
export function SkillTabPage({
  tab,
  source,
  skillId,
}: {
  tab: Exclude<SkillTab, "overview">;
  source: string;
  skillId: string;
}) {
  const [Tab, Skeleton] = TAB_PARTS[tab];

  return (
    <DataErrorBoundary label={TAB_COPY[tab].errorLabel}>
      <Suspense fallback={<Skeleton />}>
        <Tab source={source} skillId={skillId} />
      </Suspense>
    </DataErrorBoundary>
  );
}
