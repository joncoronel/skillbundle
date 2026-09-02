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
import { representativeWellKnownSkill } from "@/lib/representative-params";

type Params = Promise<{ source: string; skillId: string }>;

// One representative skill is prerendered so Next can extract an App Shell for
// this segment's routes — the Overview and each tab. Every other skill is
// served that shell instantly and upgraded in the background on its first
// visit. Lives on the layout so one export covers all four child pages.
export async function generateStaticParams() {
  const { source, skillId } = await representativeWellKnownSkill();
  return [{ source, skillId }];
}

/**
 * The frame every skill tab shares: container, breadcrumb, h1, tab strip. Same
 * synchronous params-into-Suspense shape as the GitHub tree's layout — see
 * app/(main)/[org]/[repo]/[skillId]/layout.tsx for the reasoning.
 */
export default function WellKnownSkillLayout({
  params,
  children,
}: {
  params: Params;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-12 pb-24">
      <Suspense fallback={<SkillMastheadSkeleton />}>
        <WellKnownSkillMasthead params={params} />
      </Suspense>
      {children}
    </div>
  );
}

async function WellKnownSkillMasthead({ params }: { params: Params }) {
  const { source, skillId } = await params;

  return (
    <SkillMasthead
      skillId={skillId}
      base={skillHref(source, skillId)}
      breadcrumb={
        <Breadcrumb size="sm" className="mb-6">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/" />}>Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href={`/site/${source}`} />}>
                {source}
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
