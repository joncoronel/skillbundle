import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/cubby-ui/accordion";
import { LabeledSection } from "@/components/labeled-section";
import { cn, formatDate } from "@/lib/utils";
import { externalAuditDetailUrl } from "@/lib/skill-urls";

// Verdict pill — the at-a-glance trust signal. Unknown statuses fall back to a
// neutral chip.
const STATUS_PILL: Record<string, string> = {
  pass: "bg-success/15 text-success-foreground border-success/30",
  warn: "bg-warning/15 text-warning-foreground border-warning-border",
  fail: "bg-danger/15 text-danger-foreground border-danger-border",
};

// Spoken status for accessible names. The visible pill is a short word
// ("Warn"), but screen readers should hear a natural one.
const STATUS_LABEL: Record<string, string> = {
  pass: "passed",
  warn: "warning",
  fail: "failed",
};

// The pill's visible word. The API hands us a lowercase enum; capitalising it
// beats shouting it, and beats leaving a bare "warn" mid-sentence.
const STATUS_TEXT: Record<string, string> = {
  pass: "Pass",
  warn: "Warn",
  fail: "Fail",
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
        "inline-flex items-center rounded border px-2 py-0.5 text-(length:--text-micro) font-medium",
        STATUS_PILL[status] ?? "border-border bg-muted text-muted-foreground",
        className,
      )}
    >
      {STATUS_TEXT[status] ?? status}
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
 * on its Security tab instead).
 */
export function SkillAuditSection({
  source,
  skillId,
  audits,
  className,
  as,
}: {
  source: string;
  skillId: string;
  audits: SkillAuditEntry[] | null | undefined;
  className?: string;
  as?: "h2" | "h3" | "h4";
}) {
  if (!audits || audits.length === 0) {
    return null;
  }
  return (
    <LabeledSection label="Security audits" className={className} as={as}>
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

/** One labeled field in the metadata strip. */
function MetaField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * The Security tab's report list: every provider's verdict, fully visible.
 *
 * The accordion this replaces made sense inside a dialog, where a modal has to
 * fit a viewport and the reader opened it asking about one thing. On a route of
 * its own the collapse only costs: a skill carries one to three verdicts, the
 * whole set fits on a phone without scrolling, and a summary sentence hidden
 * behind a chevron is a security finding the reader has to guess is worth
 * opening. `AuditAccordion` stays for the quick-view sheet, which is still a
 * cramped surface.
 *
 * Each provider is a block, not a card. Cards would draw three same-sized
 * boxes and make the page structure out of containers; hairlines between
 * blocks keep the verdicts in one column so the pills line up and the set reads
 * as one instrument.
 */
export function AuditReportList({
  source,
  skillId,
  audits,
}: {
  source: string;
  skillId: string;
  audits: SkillAuditEntry[];
}) {
  return (
    <ul className="divide-y divide-border border-t border-border">
      {audits.map((audit) => {
        const ts = Date.parse(audit.auditedAt);
        // Absolute, not relative. The question this answers is "did this
        // verdict see the current file?", which is settled by comparing it to
        // the dates on the History tab. "3w ago" makes the reader do that
        // arithmetic. It must also be absolute because this renders on the
        // server and `timeAgo` reads `Date.now()` (see lib/utils.ts).
        const audited = Number.isNaN(ts) ? null : formatDate(ts);
        const detail = summaryDetail(audit.summary, !!audit.riskLevel);
        const categories = audit.categories?.map(humanizeCategory) ?? [];

        return (
          <li key={audit.slug} className="py-5 first:pt-4">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <AuditBadge status={audit.status} />
                <h3 className="truncate text-sm font-medium text-foreground">
                  {audit.provider}
                </h3>
              </div>

              <a
                href={externalAuditDetailUrl(source, skillId, audit.slug)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 rounded text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50"
              >
                Full report
                <HugeiconsIcon
                  icon={ArrowUpRight01Icon}
                  strokeWidth={2}
                  className="size-3"
                />
              </a>
            </div>

            {detail && (
              // The finding itself, at body weight and a reading measure. It
              // was the thing the accordion hid.
              <p className="mt-2.5 max-w-[72ch] text-sm leading-relaxed text-foreground">
                {detail}
              </p>
            )}

            <dl className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1.5">
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

              {audited && (
                <MetaField label="Audited">
                  <time
                    dateTime={new Date(ts).toISOString()}
                    className="text-xs text-muted-foreground"
                  >
                    {audited}
                  </time>
                </MetaField>
              )}
            </dl>

            {categories.length > 0 && (
              // Behaviours the provider detected, one chip each rather than a
              // comma-joined sentence: they are a set, they repeat across
              // providers, and as chips the reader can see at a glance whether
              // two providers flagged the same thing.
              <div className="mt-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Detected behaviors
                </p>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {categories.map((category) => (
                    <li
                      key={category}
                      className="rounded bg-muted px-2 py-0.5 text-(length:--text-micro) font-medium text-muted-foreground"
                    >
                      {category}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Per-provider security audits, expandable inline. Each provider is a row:
 * verdict pill + name on the trigger; the panel reads as a small fact sheet —
 * a one-line summary over a metadata strip (risk, detected behaviors, date) and
 * a quiet link to the provider's full report. Rendered by the quick-view sheet
 * and the skill page's Security tab.
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
        // Absolute, and it sits in a <dl> beside Risk and Detected because it is
        // the same kind of thing: a fact about the audit, not a freshness
        // signal. The question this field answers is "did this verdict see the
        // current file?", which is only answerable against the dates in the
        // History timeline right below it. "3w ago" makes the reader do that
        // arithmetic; a date lets them compare two dates.
        //
        // It also has to be absolute. This renders on the server (skill detail's
        // sidebar), and timeAgo reads Date.now() — see the note on it in
        // lib/utils.ts. Today the dialog saves us by not mounting its content
        // until opened; that is a mounting detail, not a guarantee.
        const audited = Number.isNaN(ts) ? null : formatDate(ts);
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
              className="hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
            >
              {audit.provider}
            </AccordionTrigger>

            <AccordionContent>
              {detail && (
                <p className="max-w-[68ch] text-sm leading-relaxed text-foreground">
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
                      <time
                        dateTime={new Date(ts).toISOString()}
                        className="text-xs text-muted-foreground"
                      >
                        {audited}
                      </time>
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
