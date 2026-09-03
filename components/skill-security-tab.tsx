import "server-only";
import { notFound } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/cubby-ui/button";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { SkillSection } from "@/components/skill-section";
import { SkillTabEmpty } from "@/components/skill-tab-empty";
import {
  AuditAccordion,
  AuditBadge,
  worstAuditStatus,
} from "@/components/skill-audit-section";
import { loadSkill } from "@/lib/skill-cache";
import { externalSkillUrl } from "@/lib/skill-urls";
import { loadAudits } from "@/components/skill-detail-page";

/**
 * The Security tab's body: the per-provider audit accordion, promoted from the
 * dialog the record card used to open. The worst verdict rides the section
 * header as meta, same at-a-glance signal the card's Security row carries.
 *
 * The tab renders even when there are no audits — hiding it would make the tab
 * strip differ per skill, which reads as breakage, and "no audits recorded" is
 * itself the answer a maintainer came for. The empty state says which of the
 * two reasons applies: the partners have not got to it, or they cannot,
 * because the skill is not on skills.sh at all.
 */
export async function SkillSecurityTab({
  source,
  skillId,
}: {
  source: string;
  skillId: string;
}) {
  const [skill, audits] = await Promise.all([
    loadSkill(source, skillId),
    loadAudits(source, skillId),
  ]);
  if (!skill) notFound();

  const hasAudits = audits !== null && audits.length > 0;

  return (
    <SkillSection
      id="security"
      title="Security"
      rule={false}
      description="Independent checks from skills.sh's audit partners."
      meta={hasAudits && <AuditBadge status={worstAuditStatus(audits)} />}
      className="mt-8"
    >
      {hasAudits ? (
        <AuditAccordion source={source} skillId={skillId} audits={audits} />
      ) : skill.isGitHubOnly ? (
        <SkillTabEmpty title="Not audited.">
          <p>
            skills.sh&apos;s audit partners only review skills listed there, and
            this one is available only on GitHub. Verdicts appear here once it
            is listed.
          </p>
        </SkillTabEmpty>
      ) : (
        <SkillTabEmpty
          title="No audits yet."
          action={
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <a
                  href={externalSkillUrl(source, skillId)}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
              trailingIcon={
                <HugeiconsIcon
                  icon={ArrowUpRight01Icon}
                  strokeWidth={2}
                  className="size-3.5"
                />
              }
            >
              View on skills.sh
            </Button>
          }
        >
          <p>
            The audit partners review skills on their own schedule, and none has
            published a verdict for this one. SkillBundle checks for new
            verdicts daily and shows them here the day they land.
          </p>
        </SkillTabEmpty>
      )}
    </SkillSection>
  );
}

/** Suspense fallback and `loading.tsx` body for the Security tab. */
export function SkillSecurityTabSkeleton() {
  return (
    <SkillSection
      id="security"
      title="Security"
      rule={false}
      description="Independent checks from skills.sh's audit partners."
      className="mt-8"
    >
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </SkillSection>
  );
}
