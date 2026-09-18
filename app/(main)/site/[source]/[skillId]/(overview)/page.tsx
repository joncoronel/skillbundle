import type { Metadata, ResolvingMetadata } from "next";
import { notFound } from "next/navigation";
import { GlobalSearchIcon } from "@hugeicons/core-free-icons";
import { SkillDetailPage } from "@/components/skill-detail-page";
import { skillTabMetadata } from "@/lib/skill-tab-route";
import { isSafeSkillRef } from "@/lib/install-commands";
import { loadWellKnownIndexes } from "@/lib/well-known-index";

type Params = Promise<{ source: string; skillId: string }>;

// In a route group so this segment's `loading.tsx` wraps ONLY the Overview.
// A `loading.tsx` beside `layout.tsx` at `[skillId]` would be the outer
// Suspense fallback for every tab subtree too, and a tab whose RSC had not
// arrived yet would paint the two-column Overview skeleton before its own
// (docs/architecture.md §1, "pick one, not both"). `generateStaticParams`,
// `layout.tsx` and `opengraph-image.tsx` stay at `[skillId]`.

export async function generateMetadata(
  { params }: { params: Params },
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const { source, skillId } = await params;
  return skillTabMetadata("overview", source, skillId, parent);
}

export default async function WellKnownSkillPage({
  params,
}: {
  params: Params;
}) {
  const { source, skillId } = await params;
  if (!isSafeSkillRef(source, skillId)) notFound();
  // The map, not a command. A well-known skill whose domain serves no index
  // (or whose index doesn't name it) still has a page; it just shows a note
  // instead. See convex/wellKnown.ts.
  const wellKnown = await loadWellKnownIndexes(source);

  return (
    <SkillDetailPage
      source={source}
      skillId={skillId}
      wellKnown={wellKnown}
      externalUrl={`https://${source}`}
      externalIcon={GlobalSearchIcon}
      externalLabel={source}
    />
  );
}
