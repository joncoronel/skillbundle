import { LabeledSection } from "@/components/labeled-section";
import { cn } from "@/lib/utils";
import { externalAuditDetailUrl } from "@/lib/skill-urls";

const STATUS_PILL: Record<string, string> = {
  pass: "bg-success/15 text-success-foreground border-success/30",
  warn: "bg-warning/15 text-warning-foreground border-warning-border",
  fail: "bg-danger/15 text-danger-foreground border-danger-border",
};

export type SkillAuditEntry = {
  provider: string;
  slug: string;
  status: string;
  summary: string;
  auditedAt: string;
  riskLevel?: string;
  categories?: string[];
};

/**
 * Compact per-provider audit list. One row per audit: provider name on the
 * left, colored status pill on the right. The summary, risk-level subtitle,
 * and date are intentionally omitted here — they live on the external audit
 * detail page that each row links to. The goal is at-a-glance trust signal,
 * not a wall of text inline.
 *
 * Renders nothing when audits is null/empty, since most skills won't have
 * an audit until they've been installed at least once.
 */
export function SkillAuditSection({
  source,
  skillId,
  audits,
  className,
}: {
  source: string;
  skillId: string;
  audits: SkillAuditEntry[] | null | undefined;
  className?: string;
}) {
  if (!audits || audits.length === 0) {
    return null;
  }

  return (
    <LabeledSection label="Security Audits" className={className}>
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {audits.map((audit) => {
          const pill =
            STATUS_PILL[audit.status] ??
            "bg-muted text-muted-foreground border-border";
          const detailUrl = externalAuditDetailUrl(source, skillId, audit.slug);
          return (
            <li key={audit.slug}>
              <a
                href={detailUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-3 px-4 py-2.5 hover:duration-0 duration-200 transition-colors hover:bg-muted"
              >
                <span className="text-sm font-medium text-foreground">
                  {audit.provider}
                </span>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center rounded border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider",
                    pill,
                  )}
                >
                  {audit.status}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </LabeledSection>
  );
}
