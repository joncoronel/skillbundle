import "server-only";
import { notFound } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/cubby-ui/button";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { SkillSection } from "@/components/skill-section";
import { SkillTabEmpty } from "@/components/skill-tab-empty";
import {
  AuditBadge,
  AuditReportList,
  worstAuditStatus,
} from "@/components/skill-audit-section";
import { loadAudits, loadSkill } from "@/lib/skill-cache";
import { formatDate } from "@/lib/utils";
import { externalSkillUrl } from "@/lib/skill-urls";

/**
 * The Security tab's body: every provider's verdict, fully visible. It was an
 * accordion inside a dialog opened from the record card; the collapse earned
 * its place in a modal and does not on a route (see AuditReportList). The
 * worst verdict rides the section header as meta, the same at-a-glance signal
 * the card's Security row carries.
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
  // Newest audit across providers. The date answers "did anyone look at the
  // current file?", which is the second question after the verdict itself.
  const latest = hasAudits
    ? audits.reduce<number | null>((newest, a) => {
        const ts = Date.parse(a.auditedAt);
        if (Number.isNaN(ts)) return newest;
        return newest === null || ts > newest ? ts : newest;
      }, null)
    : null;

  return (
    <SkillSection
      id="security"
      title="Security"
      rule={false}
      description="Independent checks from skills.sh's audit partners."
      // The verdict, not the word "Security": the tab strip already said that,
      // and this is the line the reader came for. See SkillSection.
      titleHidden
      summary={
        hasAudits ? (
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground">
            <AuditBadge status={worstAuditStatus(audits)} />
            <span className="font-medium text-foreground">
              {audits.length} {audits.length === 1 ? "provider" : "providers"}
            </span>
            {latest !== null && <span>latest audit {formatDate(latest)}</span>}
          </p>
        ) : undefined
      }
      className="mt-8"
    >
      {hasAudits ? (
        <AuditReportList source={source} skillId={skillId} audits={audits} />
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
      titleHidden
      summary={<Skeleton className="h-4 w-56" />}
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
