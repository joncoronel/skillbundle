"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/cubby-ui/accordion";
import { LabeledSection } from "@/components/labeled-section";
import { cn, timeAgo } from "@/lib/utils";
import { externalAuditDetailUrl } from "@/lib/skill-urls";

// Verdict pill on the trigger — the at-a-glance trust signal, kept from the
// previous compact list. Unknown statuses fall back to a neutral chip.
const STATUS_PILL: Record<string, string> = {
  pass: "bg-success/15 text-success-foreground border-success/30",
  warn: "bg-warning/15 text-warning-foreground border-warning-border",
  fail: "bg-danger/15 text-danger-foreground border-danger-border",
};

// Risk-level → severity dot color. The verdict pill on the trigger carries the
// loud signal; in the panel the level is detail, so a small saturated dot is
// enough (color is never the sole cue — the "Risk" label + level text carry
// it). Tolerant of values outside our typed enum: Agent Trust Hub returns
// "SAFE", which isn't in AuditRiskLevel.
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
 * Risk as its own field, so the same verdict doesn't appear twice. Snyk emits
 * "Risk: MEDIUM · 1 issue" → "1 issue"; "Risk: LOW · No issues" → "No issues";
 * a bare "Risk: LOW" → "" (summary hidden). Other providers' prose is untouched.
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
 * Per-provider security audits, expandable inline. Each provider is an
 * accordion row: verdict pill + provider name on the trigger; the panel reads
 * as a small fact sheet — a one-line summary over a metadata strip (risk level,
 * detected behaviors, audit date) and a quiet link to the provider's full
 * report on skills.sh for findings the API doesn't expose.
 *
 * All rows start collapsed; the verdict pill carries the at-a-glance signal,
 * and any provider can be expanded for detail. Renders nothing when there are
 * no audits — most skills won't have one until they've been installed once.
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
      <Accordion variant="outline" multiple>
        {audits.map((audit) => {
          const pill =
            STATUS_PILL[audit.status] ??
            "bg-muted text-muted-foreground border-border";
          const detailUrl = externalAuditDetailUrl(source, skillId, audit.slug);
          const ts = Date.parse(audit.auditedAt);
          const audited = Number.isNaN(ts) ? null : timeAgo(ts);
          const detail = summaryDetail(audit.summary, !!audit.riskLevel);
          const categories = audit.categories?.map(humanizeCategory) ?? [];

          return (
            <AccordionItem key={audit.slug} value={audit.slug}>
              <AccordionTrigger
                indicatorType="chevron"
                aria-label={`${audit.provider}: ${audit.status}`}
                icon={
                  <span
                    className={cn(
                      "inline-flex items-center rounded border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider",
                      pill,
                    )}
                  >
                    {audit.status}
                  </span>
                }
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
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      className="size-3"
                      aria-hidden="true"
                    >
                      <path
                        d="M7 17 17 7M9 7h8v8"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </a>
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </LabeledSection>
  );
}
