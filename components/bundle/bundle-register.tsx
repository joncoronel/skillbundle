"use client";

/**
 * DIRECTION CONTRACT — bundle register
 *
 * THESIS: A bundle is a register of what you depend on, not a gallery of what
 * you collected. Refuses the category default this page shipped for a year: a
 * grid of same-size skill cards, which makes twelve dependencies look like
 * twelve equally-fine choices and hides the one that regressed.
 *
 * OWN-WORLD: The committed Control Panel system — violet-tinted neutrals, one
 * blue signal, surface-3 panels, mono for labels and data. No new tokens.
 *
 * STORY: The reader arrives asking "is my setup still OK?", reads the tally,
 * and finds the worst thing already at the top because the register is ordered
 * by consequence rather than by name or date.
 *
 * FIRST VIEWPORT: Bundle identity, then a one-line tally with the status light,
 * then the register's mono column strip and its first rows. Install is a
 * disclosure in the tally line — it stays reachable, it stops leading.
 *
 * FORM: Audit register. #2 on the ordered list; the roll assigned index 1 of 7
 * (seed key skillbundle-bundle-page-2026-08-08, dealt via the impeccable roll
 * API after the local renderer returned empty).
 *
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 * finish review, the verdict, and DESIGN.md.
 */

import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  FileEditIcon,
  SecurityWarningIcon,
  TextAlignLeftIcon,
  Alert02Icon,
  ViewOffSlashIcon,
  CheckmarkBadge02Icon,
} from "@hugeicons/core-free-icons";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/cubby-ui/table";
import { skillHref } from "@/lib/skill-urls";
import { cn, timeAgo } from "@/lib/utils";

/** One skill as the bundle read returns it, plus whatever changed about it. */
export type RegisterSkill = {
  source: string;
  skillId: string;
  name: string;
  isDelisted: boolean;
  hasContentFetchError: boolean;
  curatedOwner?: string;
  worstAuditStatus?: string;
  worstAuditRiskLevel?: string;
  addedAt?: number;
};

export type RegisterChange = {
  key: string;
  kind: "audit" | "description" | "content";
  changedAt: number;
  audit?: { from: string; to: string; riskLevel?: string; changedAt: number };
  version: { descriptionBefore?: string; descriptionAfter?: string } | null;
};

/**
 * Row condition, in consequence order. This single ranking is what makes the
 * register a triage without needing a separate "needs attention" section: sort
 * by it and the worst thing is always the first row.
 *
 * The first three are things that are WRONG (the bundle may not install, or may
 * not be safe). The next two are things that MOVED. Steady is the rest, and on
 * a healthy bundle it is every row — which is the state this page should make
 * look calm rather than empty.
 */
type Condition =
  | "audit"
  | "delisted"
  | "fetch-error"
  | "description"
  | "content"
  | "steady";

const RANK: Record<Condition, number> = {
  audit: 5,
  delisted: 4,
  "fetch-error": 3,
  description: 2,
  content: 1,
  steady: 0,
};

/** Conditions that mean something is wrong, as opposed to merely new. */
const IS_FAULT: Record<Condition, boolean> = {
  audit: true,
  delisted: true,
  "fetch-error": true,
  description: false,
  content: false,
  steady: false,
};

const CONDITION_META: Record<
  Condition,
  { icon: IconSvgElement; label: string; tone: string }
> = {
  audit: {
    icon: SecurityWarningIcon,
    label: "Security verdict changed",
    tone: "text-danger-foreground",
  },
  delisted: {
    icon: ViewOffSlashIcon,
    label: "No longer listed",
    tone: "text-warning-foreground",
  },
  "fetch-error": {
    icon: Alert02Icon,
    label: "Install may fail",
    tone: "text-warning-foreground",
  },
  description: {
    icon: TextAlignLeftIcon,
    label: "Description changed",
    tone: "text-warning-foreground",
  },
  content: {
    icon: FileEditIcon,
    label: "Content edited",
    tone: "text-muted-foreground",
  },
  steady: {
    icon: CheckmarkBadge02Icon,
    label: "Steady",
    tone: "text-muted-foreground/60",
  },
};

function conditionOf(
  skill: RegisterSkill,
  change: RegisterChange | undefined,
): Condition {
  if (change?.kind === "audit") return "audit";
  if (skill.isDelisted) return "delisted";
  if (skill.hasContentFetchError) return "fetch-error";
  if (change?.kind === "description") return "description";
  if (change?.kind === "content") return "content";
  return "steady";
}

export type RegisterRow = {
  skill: RegisterSkill;
  change?: RegisterChange;
  condition: Condition;
};

export function buildRegister(
  skills: RegisterSkill[],
  changes: RegisterChange[] | undefined,
): { rows: RegisterRow[]; faults: number; changed: number; steady: number } {
  const byKey = new Map((changes ?? []).map((c) => [c.key, c]));

  const rows = skills.map((skill) => {
    const change = byKey.get(`${skill.source}::${skill.skillId}`);
    return { skill, change, condition: conditionOf(skill, change) };
  });

  // Consequence first, then recency, then name — so the order is stable for
  // the long tail of steady rows that share a rank.
  rows.sort(
    (a, b) =>
      RANK[b.condition] - RANK[a.condition] ||
      (b.change?.changedAt ?? 0) - (a.change?.changedAt ?? 0) ||
      a.skill.name.localeCompare(b.skill.name),
  );

  let faults = 0;
  let changed = 0;
  for (const r of rows) {
    if (IS_FAULT[r.condition]) faults++;
    else if (r.condition !== "steady") changed++;
  }
  return { rows, faults, changed, steady: rows.length - faults - changed };
}

/**
 * The register.
 *
 * A real `<table>`, not a grid of divs: the reader scans DOWN the condition
 * column to find what is wrong, and that is a column relationship a screen
 * reader should get for free.
 *
 * Narrow viewports drop the trailing columns and fold the condition up into the
 * skill cell. An earlier pass refused to reflow at all and left the condition
 * column parked off the right edge behind a horizontal scroll — hiding the one
 * column the reader came for. What has to survive on a phone is the row order
 * and the leading marker, not the column count.
 */
export function BundleRegister({ rows }: { rows: RegisterRow[] }) {
  return (
    // `md:max-w-none` overrides the Table component's own 672px cap, which is
    // tuned for a table sitting beside other content. This one IS the content.
    // `table-fixed` gives each column a width that does not shift as rows
    // change condition. Note the paired `whitespace-normal` on the prose cells
    // below: TableCell ships `whitespace-nowrap`, which is right for the data
    // tables this component was built for and silently truncated every
    // description delta mid-word here.
    <Table className="table-fixed md:max-w-none">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-8">
            <span className="sr-only">Condition marker</span>
          </TableHead>
          <TableHead className="w-[38%] sm:w-[26%]">Skill</TableHead>
          <TableHead className="hidden sm:table-cell">Condition</TableHead>
          <TableHead className="hidden md:table-cell w-28">Audit</TableHead>
          <TableHead className="hidden sm:table-cell w-24 text-right">
            Added
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <RegisterRowView
            key={`${row.skill.source}::${row.skill.skillId}`}
            row={row}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function RegisterRowView({ row }: { row: RegisterRow }) {
  const { skill, change, condition } = row;
  const meta = CONDITION_META[condition];
  const delta =
    condition === "description"
      ? {
          before: change?.version?.descriptionBefore,
          after: change?.version?.descriptionAfter,
        }
      : null;
  const hasDelta = Boolean(delta?.before || delta?.after);

  return (
    <TableRow className={cn(condition === "steady" && "text-muted-foreground")}>
      <TableCell className="align-top">
        <HugeiconsIcon
          icon={meta.icon}
          strokeWidth={2}
          aria-hidden
          className={cn("mt-0.5 size-4", meta.tone)}
        />
      </TableCell>

      <TableCell className="align-top whitespace-normal">
        <Link
          href={skillHref(skill.source, skill.skillId)}
          className="group inline-flex items-center gap-1 font-medium text-foreground outline-none hover:underline focus-visible:underline"
        >
          {skill.name}
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            strokeWidth={2}
            aria-hidden
            className="size-3.5 text-muted-foreground/50 transition-transform duration-100 group-hover:translate-x-0.5 motion-reduce:transition-none"
          />
        </Link>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {skill.source}
        </p>
        {/* Below sm the Condition column is gone, so its content lives here. */}
        <div className="sm:hidden">
          <ConditionDetail
            condition={condition}
            label={meta.label}
            change={change}
            delta={hasDelta ? delta : null}
          />
        </div>
      </TableCell>

      <TableCell className="hidden sm:table-cell align-top whitespace-normal">
        <ConditionDetail
          condition={condition}
          label={meta.label}
          change={change}
          delta={hasDelta ? delta : null}
        />
      </TableCell>

      <TableCell className="hidden md:table-cell align-top">
        <AuditCell
          status={skill.worstAuditStatus}
          riskLevel={skill.worstAuditRiskLevel}
        />
      </TableCell>

      <TableCell className="hidden sm:table-cell align-top text-right text-xs tabular-nums text-muted-foreground">
        {skill.addedAt ? timeAgo(skill.addedAt) : "—"}
      </TableCell>
    </TableRow>
  );
}

/**
 * Everything the register says about a row's condition. Rendered into whichever
 * cell is visible at the current width — defined once so the two mount points
 * cannot drift.
 */
function ConditionDetail({
  condition,
  label,
  change,
  delta,
}: {
  condition: Condition;
  label: string;
  change?: RegisterChange;
  delta: { before?: string; after?: string } | null;
}) {
  return (
    <div className="mt-1 sm:mt-0">
      {condition === "steady" ? (
        <>
          {/* Steady still announces itself to a screen reader; it just does not
              spend a line of the reader's attention on every quiet row. */}
          <span className="sr-only">{label}</span>
          <span aria-hidden className="text-sm text-muted-foreground/50">
            &mdash;
          </span>
        </>
      ) : (
        <span className="text-sm">{label}</span>
      )}

      {change?.audit ? (
        <p className="mt-1 font-mono text-xs uppercase tracking-eyebrow text-danger-foreground">
          {change.audit.from} &rarr; {change.audit.to}
          {change.audit.riskLevel ? ` · ${change.audit.riskLevel}` : null}
        </p>
      ) : null}

      {delta ? <DescriptionDelta {...delta} /> : null}

      {change ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {timeAgo(change.changedAt)}
        </p>
      ) : null}
    </div>
  );
}

const AUDIT_TONE: Record<string, string> = {
  pass: "text-success-foreground",
  warn: "text-warning-foreground",
  fail: "text-danger-foreground",
};

function AuditCell({
  status,
  riskLevel,
}: {
  status?: string;
  riskLevel?: string;
}) {
  if (!status || status === "unknown") {
    return (
      <span className="font-mono text-xs uppercase tracking-eyebrow text-muted-foreground/50">
        &mdash;
      </span>
    );
  }
  return (
    <span
      className={cn(
        "font-mono text-xs uppercase tracking-eyebrow",
        AUDIT_TONE[status] ?? "text-muted-foreground",
      )}
    >
      {status}
      {riskLevel && status !== "pass" ? (
        <span className="block text-muted-foreground">{riskLevel}</span>
      ) : null}
    </span>
  );
}

/**
 * Before/after of a skill's description, inline in its row.
 *
 * The same two-line form the dashboard panel uses, deliberately: a reader who
 * saw the change announced there should meet the identical object here. `−`/`+`
 * are diff notation carrying the meaning on their own, because PRODUCT.md
 * commits to colour never being the sole indicator of state.
 */
function DescriptionDelta({
  before,
  after,
}: {
  before?: string;
  after?: string;
}) {
  return (
    <div className="mt-1.5 max-w-[62ch] space-y-0.5 text-xs leading-relaxed">
      {before ? (
        <p className="flex gap-2">
          <span aria-hidden className="font-mono text-danger-foreground">
            &minus;
          </span>
          <span className="sr-only">Was: </span>
          <span className="min-w-0 line-clamp-2 text-muted-foreground line-through decoration-muted-foreground/40">
            {before}
          </span>
        </p>
      ) : null}
      {after ? (
        <p className="flex gap-2">
          <span aria-hidden className="font-mono text-success-foreground">
            +
          </span>
          <span className="sr-only">Now: </span>
          <span className="min-w-0 line-clamp-2 text-foreground">{after}</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The tally: the register's summary row, and the page's answer to "is anything
 * wrong?" before any of its contents.
 *
 * States its numbers in words rather than as a strip of big figures. A metric
 * hero would make three counts look like the page's subject; the subject is the
 * register underneath, and this is its caption.
 */
export function RegisterTally({
  total,
  faults,
  changed,
  steady,
  action,
}: {
  total: number;
  faults: number;
  changed: number;
  steady: number;
  action?: React.ReactNode;
}) {
  const tone: "clear" | "changed" | "fault" =
    faults > 0 ? "fault" : changed > 0 ? "changed" : "clear";

  const dot = {
    clear: "bg-success-foreground",
    changed: "bg-warning-foreground",
    fault: "bg-danger-foreground",
  }[tone];
  const halo = {
    clear: "bg-success/20",
    changed: "bg-warning/20",
    fault: "bg-danger/20",
  }[tone];

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span
        aria-hidden
        className={cn(
          "grid size-5 shrink-0 place-items-center rounded-full",
          halo,
        )}
      >
        <span className={cn("size-1.5 rounded-full", dot)} />
      </span>

      <p className="flex-1 text-sm">
        {total === 0 ? (
          <span className="text-muted-foreground">No skills yet.</span>
        ) : tone === "clear" ? (
          <>
            <span className="font-medium">All steady.</span>{" "}
            <span className="text-muted-foreground tabular-nums">
              {total} skill{total === 1 ? "" : "s"}, nothing changed since you
              added them.
            </span>
          </>
        ) : (
          <>
            <span className="font-medium tabular-nums">
              {faults > 0
                ? `${faults} need${faults === 1 ? "s" : ""} attention`
                : `${changed} changed`}
            </span>{" "}
            <span className="text-muted-foreground tabular-nums">
              {faults > 0 && changed > 0 ? `· ${changed} changed ` : ""}·{" "}
              {steady} steady
            </span>
          </>
        )}
      </p>

      {action}
    </div>
  );
}
