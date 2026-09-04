import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import {
  SkillMasthead,
  SkillMastheadSkeleton,
} from "@/components/skill-masthead";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/cubby-ui/breadcrumbs";
import { skillHref } from "@/lib/skill-urls";
import { hasSkillCopies, loadSkillSyncData } from "@/lib/skill-cache";
import { representativeGitHubSkill } from "@/lib/representative-params";

type Params = Promise<{ org: string; repo: string; skillId: string }>;

// One representative skill is prerendered so Next can extract an App Shell for
// this segment's routes — the Overview and each tab. Every other skill is
// served that shell instantly and upgraded in the background on its first
// visit. Lives on the layout so one export covers all four child pages.
export async function generateStaticParams() {
  const { source, skillId } = await representativeGitHubSkill();
  const [org, repo] = source.split("/");
  return [{ org, repo, skillId }];
}

/**
 * The frame every skill tab shares: container, breadcrumb, h1, tab strip. It
 * persists across tab navigations, so switching tabs repaints only the region
 * below the strip.
 *
 * Deliberately synchronous, with `params` passed INTO the Suspense boundary —
 * the same split the listing routes use (docs/architecture.md §1). Awaiting
 * params here would suspend the whole layout and nothing below it (including
 * each tab's `loading.tsx`) could commit instantly. The tab strip renders
 * inside that boundary too (its hrefs are built from params) and its skeleton
 * draws the four always-present labels as static text, so the shell keeps the
 * strip's structure while the links wait on the URL. A skill with copies gains
 * a fifth tab at the end of the strip when the masthead resolves.
 */
export default function SkillLayout({
  params,
  children,
}: {
  params: Params;
  children: ReactNode;
}) {
  return (
    // `max-w-6xl`, the app's default page width (DESIGN.md §4), with no
    // special case — see skill-detail-page.tsx for why this page stopped
    // widening past it.
    <div className="mx-auto max-w-6xl px-4 pt-12 pb-24">
      <Suspense fallback={<SkillMastheadSkeleton />}>
        <GitHubSkillMasthead params={params} />
      </Suspense>
      {children}
    </div>
  );
}

async function GitHubSkillMasthead({ params }: { params: Params }) {
  const { org, repo, skillId } = await params;
  const source = `${org}/${repo}`;
  // The tab strip needs to know whether this skill has copies. Loaded here,
  // inside the boundary that already awaits `params`, and through the SAME
  // `'use cache'` entry the Copies, History and Stats tabs read, so it costs
  // no extra Convex call on any path.
  const { copies } = await loadSkillSyncData(source, skillId);

  return (
    <SkillMasthead
      skillId={skillId}
      base={skillHref(source, skillId)}
      hasCopies={hasSkillCopies(copies)}
      breadcrumb={
        <Breadcrumb size="sm" className="mb-6">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/" />}>Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href={`/${org}`} />}>
                {org}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href={`/${source}`} />}>
                {repo}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{skillId}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
    />
  );
}
