import "server-only";
import type { Metadata, ResolvingMetadata } from "next";
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
import { skillHref, skillTabHref, type SkillTab } from "@/lib/skill-urls";
import { NOT_FOUND_ROBOTS } from "@/lib/soft-404";

/**
 * Everything the eight skill route files (four tabs x two route trees) have
 * in common, so each of them is a few lines: resolve `params` into a source,
 * call these. The trees differ only in how `params` becomes a source and in
 * the external-link props the Overview needs.
 */

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
 * Metadata for any skill tab. Carries `openGraph.images` over from `parent`,
 * and that is the reason this is one function: `openGraph` is replaced whole by
 * the deepest segment that sets it, and the file-convention image in
 * `[skillId]/opengraph-image.tsx` only auto-merges at its own segment. Every
 * tab page, and the Overview in its `(overview)` group, is a deeper segment,
 * so without this their share links carry no image.
 *
 * Inherited, never written out. Next suffixes a metadata route's URL with a
 * hash of its folder path whenever that path contains a route group, so this
 * image is served at `.../opengraph-image-1ak9wt`, not `.../opengraph-image`
 * (`getMetadataRouteSuffix` in next/dist/lib/metadata/get-metadata-route.js).
 * A hand-built URL here 404'd on every skill page from Sep 3 to Sep 10 2026,
 * and nothing failed: the page renders either way, only the unfurl breaks.
 */
export async function skillTabMetadata(
  tab: SkillTab,
  source: string,
  skillId: string,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const skill = await loadSkill(source, skillId);
  // `noindex` here covers all ten skill-tab routes at once (five tabs across
  // both the GitHub and well-known namespaces), which is the bulk of the
  // catalog's ~16k pages. See lib/soft-404.ts for why the status code itself
  // cannot be 404 on these routes and why the meta tag is the fix.
  if (!skill) {
    return { title: "Skill Not Found | SkillBundle", robots: NOT_FOUND_ROBOTS };
  }

  const title =
    tab === "overview"
      ? `${skill.name} | SkillBundle`
      : `${skill.name} ${TAB_COPY[tab].suffix} | SkillBundle`;
  const description =
    tab === "overview"
      ? (skill.description ?? `${skill.name} — a skill from ${source}`)
      : TAB_COPY[tab].description(skill.name);
  // Each tab is its own canonical page, not a duplicate of the Overview: the
  // content differs. The sitemap lists only Overviews; tabs are found by links.
  const path = skillTabHref(skillHref(source, skillId), tab);
  const alt = `${skill.name} on SkillBundle`;
  const images = ((await parent).openGraph?.images ?? []).map((image) =>
    typeof image === "string" || image instanceof URL
      ? image
      : { ...image, alt },
  );

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, type: "article", url: path, images },
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
