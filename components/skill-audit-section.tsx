import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/cubby-ui/accordion";
import { LabeledSection } from "@/components/labeled-section";
import { cn, timeAgo } from "@/lib/utils";
import { externalAuditDetailUrl } from "@/lib/skill-urls";

// Verdict pill — the at-a-glance trust signal. Unknown statuses fall back to a
// neutral chip.
const STATUS_PILL: Record<string, string> = {
  pass: "bg-success/15 text-success-foreground border-success/30",
  warn: "bg-warning/15 text-warning-foreground border-warning-border",
  fail: "bg-danger/15 text-danger-foreground border-danger-border",
};

// Spoken status for accessible names. The visible pill is uppercase ("WARN"),
// but screen readers should hear a natural word.
const STATUS_LABEL: Record<string, string> = {
  pass: "passed",
  warn: "warning",
  fail: "failed",
};

// Risk-level → severity dot color (the verdict pill carries the loud signal;
// in the panel the level is detail, so a small dot is enough). Tolerant of
// values outside our enum — Agent Trust Hub returns "SAFE".
const RISK_DOT: Record<string, string> = {
  NONE: "bg-success-foreground",
  SAFE: "bg-success-foreground",
  LOW: "bg-muted-foreground",
  MEDIUM: "bg-warning-foreground",
  HIGH: "bg-danger-foreground",
  CRITICAL: "bg-danger-foreground",
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

/** The verdict pill, shared by the sidebar summary list and the accordion. */
export function AuditBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider",
        STATUS_PILL[status] ?? "bg-muted text-muted-foreground border-border",
        className,
      )}
    >
      {status}
    </span>
  );
}

/** Worst verdict across providers, for the sidebar's one-line summary. */
export function worstAuditStatus(audits: SkillAuditEntry[]): string {
  if (audits.some((a) => a.status === "fail")) return "fail";
  if (audits.some((a) => a.status === "warn")) return "warn";
  return "pass";
}

/**
 * Labeled "Security Audits" block wrapping the accordion, with the empty guard.
 * Used by the quick-view sheet (the full skill page renders the accordion
 * inside a dialog from the sidebar instead).
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
      <AuditAccordion source={source} skillId={skillId} audits={audits} />
    </LabeledSection>
  );
}

/** "EXTERNAL_DOWNLOADS" → "External downloads". */
function humanizeCategory(category: string): string {
  return category
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** "MEDIUM" → "Medium". Softer than shouting the raw enum in a value slot. */
function formatRisk(level: string): string {
  return level.charAt(0).toUpperCase() + level.slice(1).toLowerCase();
}

/**
 * Strip a leading "Risk: LEVEL ·" restatement from the summary when we render
 * Risk as its own field, so the verdict doesn't appear twice.
 */
function summaryDetail(summary: string, hasRiskField: boolean): string {
  if (!hasRiskField) return summary.trim();
  return summary.replace(/^\s*risk:\s*[a-z]+\b\s*[·•\-–:]?\s*/i, "").trim();
}

/** One mono-labeled field in the metadata strip. */
function MetaField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * Per-provider security audits, expandable inline. Each provider is a row:
 * verdict pill + name on the trigger; the panel reads as a small fact sheet —
 * a one-line summary over a metadata strip (risk, detected behaviors, date) and
 * a quiet link to the provider's full report. Rendered inside the security
 * dialog from the sidebar.
 */
export function AuditAccordion({
  source,
  skillId,
  audits,
}: {
  source: string;
  skillId: string;
  audits: SkillAuditEntry[];
}) {
  return (
    <Accordion variant="outline" multiple>
      {audits.map((audit) => {
        const detailUrl = externalAuditDetailUrl(source, skillId, audit.slug);
        const ts = Date.parse(audit.auditedAt);
        const audited = Number.isNaN(ts) ? null : timeAgo(ts);
        const detail = summaryDetail(audit.summary, !!audit.riskLevel);
        const categories = audit.categories?.map(humanizeCategory) ?? [];

        return (
          <AccordionItem key={audit.slug} value={audit.slug}>
            <AccordionTrigger
              indicatorType="chevron"
              aria-label={`${audit.provider}: audit ${
                STATUS_LABEL[audit.status] ?? audit.status
              }`}
              icon={<AuditBadge status={audit.status} />}
              className="hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
            >
              {audit.provider}
            </AccordionTrigger>

            <AccordionContent>
              {detail && (
                <p className="max-w-[68ch] text-pretty text-sm leading-relaxed text-foreground">
                  {detail}
                </p>
              )}

              <div
                className={cn(
                  "flex flex-wrap items-center justify-between gap-x-6 gap-y-2",
                  detail && "mt-4 border-t border-border pt-3",
                )}
              >
                <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
                  {audit.riskLevel && (
                    <MetaField label="Risk">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                        <span
                          aria-hidden="true"
                          className={cn(
                            "size-1.5 rounded-full",
                            RISK_DOT[audit.riskLevel] ?? "bg-muted-foreground",
                          )}
                        />
                        {formatRisk(audit.riskLevel)}
                      </span>
                    </MetaField>
                  )}

                  {categories.length > 0 && (
                    <MetaField label="Detected">
                      <span className="text-xs font-medium text-foreground">
                        {categories.join(", ")}
                      </span>
                    </MetaField>
                  )}

                  {audited && (
                    <MetaField label="Audited">
                      <span className="text-xs text-muted-foreground">
                        {audited}
                      </span>
                    </MetaField>
                  )}
                </dl>

                <a
                  href={detailUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Full report
                  <HugeiconsIcon
                    icon={ArrowUpRight01Icon}
                    strokeWidth={2}
                    className="size-3"
                  />
                </a>
              </div>
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}
