import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GithubIcon } from "@hugeicons/core-free-icons";
import { SkillDetailPage } from "@/components/skill-detail-page";
import { skillTabMetadata } from "@/lib/skill-tab-route";
import { buildSkillInstallCommand } from "@/lib/install-commands";

type Params = Promise<{ org: string; repo: string; skillId: string }>;

// In a route group so this segment's `loading.tsx` wraps ONLY the Overview.
// A `loading.tsx` beside `layout.tsx` at `[skillId]` would be the outer
// Suspense fallback for every tab subtree too, and a tab whose RSC had not
// arrived yet would paint the two-column Overview skeleton before its own
// (docs/architecture.md §1, "pick one, not both"). `generateStaticParams`,
// `layout.tsx` and `opengraph-image.tsx` stay at `[skillId]`.

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { org, repo, skillId } = await params;
  const source = `${org}/${repo}`;
  return skillTabMetadata("overview", source, skillId);
}

export default async function SkillPage({ params }: { params: Params }) {
  const { org, repo, skillId } = await params;
  const source = `${org}/${repo}`;
  const installCommand = buildSkillInstallCommand(source, skillId);
  if (installCommand === null) notFound();

  return (
    <SkillDetailPage
      source={source}
      skillId={skillId}
      installCommand={installCommand}
      externalUrl={`https://github.com/${source}`}
      externalIcon={GithubIcon}
      externalLabel={source}
    />
  );
}
