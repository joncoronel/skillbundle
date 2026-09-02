import "server-only";
import { notFound } from "next/navigation";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { SkillSection } from "@/components/skill-section";
import {
  AuditAccordion,
  AuditBadge,
  worstAuditStatus,
} from "@/components/skill-audit-section";
import { loadSkill } from "@/lib/skill-cache";
import { loadAudits } from "@/components/skill-detail-page";

/**
 * The Security tab's body: the per-provider audit accordion, promoted from the
 * dialog the record card used to open. The worst verdict rides the section
 * header as meta, same at-a-glance signal the card's Security row carries.
 *
 * The tab renders even when there are no audits — hiding it would make the tab
 * strip differ per skill, which reads as breakage, and "no audits recorded" is
 * itself the answer a maintainer came for.
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
      className="mt-8 max-w-3xl"
    >
      {hasAudits ? (
        <AuditAccordion source={source} skillId={skillId} audits={audits} />
      ) : (
        <p className="max-w-prose text-sm text-muted-foreground">
          {skill.isGitHubOnly
            ? "This skill is available only on GitHub, and skills.sh's audit partners only review listed skills — so no audits exist for it yet."
            : "No security audits recorded for this skill yet."}
        </p>
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
      className="mt-8 max-w-3xl"
    >
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </SkillSection>
  );
}
