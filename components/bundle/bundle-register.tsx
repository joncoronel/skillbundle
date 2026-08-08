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
 * disclosure in the tally line — it stays reachable, it stops leading. The
 * section is labelled "Skills", not "Register": the register is the form, and
 * naming the metaphor at the reader is not the product's own language.
 *
 * FORM: Audit register. #2 on the ordered list; the roll assigned index 1 of 7
 * (seed key skillbundle-bundle-page-2026-08-08, dealt via the impeccable roll
 * API after the local renderer returned empty).
 *
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 * finish review, the verdict, and DESIGN.md.
 */

import { useState } from "react";
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
  Cancel01Icon,
  ArrowTurnBackwardIcon,
} from "@hugeicons/core-free-icons";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/cubby-ui/table";
import { Button } from "@/components/ui/cubby-ui/button";
import { MarchingBorder } from "@/components/ui/cubby-ui/marching-border/marching-border";
import { OfficialBadge } from "@/components/skill-badges";
import { skillHref } from "@/lib/skill-urls";
import { cn, timeAgo } from "@/lib/utils";

/** One skill as the bundle read returns it, plus whatever changed about it. */
export type RegisterSkill = {
  source: string;
  skillId: string;
  name: string;
  isDelisted?: boolean;
  hasContentFetchError?: boolean;
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
  { icon: IconSvgElement | null; label: string; tone: string }
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
  // No glyph. `CheckmarkBadge02Icon` was here and it is the Official mark's
  // icon (skill-badges.tsx) — the same shape meaning "verified first-party" in
  // the catalog and "nothing wrong" here. Beyond the collision, a marker on
  // every healthy row is not a marker: the column exists so the eye lands on
  // the few rows that need something, and forty checkmarks defeat that. Steady
  // reads as an empty cell, and says "Steady" to a screen reader.
  steady: {
    icon: null,
    label: "Steady",
    tone: "text-muted-foreground",
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

export type RegisterRow<S extends RegisterSkill = RegisterSkill> = {
  skill: S;
  change?: RegisterChange;
  condition: Condition;
  /** Set only in edit mode, for skills staged but not yet saved. */
  status?: "added" | "removed";
};

/** Edit-mode handlers. Their presence is what puts the register in edit mode. */
export type RegisterActions<S extends RegisterSkill = RegisterSkill> = {
  onRemove: (skill: S) => void;
  onRestore: (skill: S) => void;
};

/**
 * Generic over the caller's skill type rather than narrowing to
 * `RegisterSkill`: the bundle page feeds the consequence-ordered rows straight
 * back into its edit mode, which needs the full skill object, and a widened
 * return type would have forced a cast there.
 */
export function buildRegister<S extends RegisterSkill>(
  skills: S[],
  changes: RegisterChange[] | undefined,
): { rows: RegisterRow<S>[]; faults: number; changed: number; steady: number } {
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
export function BundleRegister<S extends RegisterSkill>({
  rows,
  pending,
  actions,
}: {
  rows: RegisterRow<S>[];
  pending: boolean;
  actions?: RegisterActions<S>;
}) {
  const editing = actions !== undefined;
  const [showSteady, setShowSteady] = useState(false);

  // Split, not filter. On a healthy bundle every row is steady, and forty rows
  // of em-dash is the version of "calm" that reads as "empty" — but hiding the
  // inventory outright would cost the reader their sense of what they have. So
  // the quiet rows collapse behind their own count, always on screen, one click
  // from the full list.
  //
  // Never collapsed in edit mode: there you are managing the inventory, not
  // triaging it, and a hidden row cannot be removed.
  const notable = editing ? rows : rows.filter((r) => r.condition !== "steady");
  const steady = editing ? [] : rows.filter((r) => r.condition === "steady");
  const visible = showSteady ? [...notable, ...steady] : notable;
  const columnCount = editing ? 6 : 5;

  return (
    // `md:max-w-none` overrides the Table component's own 672px cap, which is
    // tuned for a table sitting beside other content. This one IS the content.
    // `table-fixed` gives each column a width that does not shift as rows
    // change condition. Note the paired `whitespace-normal` on the prose cells
    // below: TableCell ships `whitespace-nowrap`, which is right for the data
    // tables this component was built for and silently truncated every
    // description delta mid-word here.
    // `max-h` is what makes the sticky header actually stick: Table pins it
    // inside its own scroll area, and an area with no height cap never scrolls,
    // so the page scrolls instead and the labels leave with it. Viewport-
    // relative rather than a fixed pixel height so a short bundle gets no inner
    // scrollbar at all.
    <Table className="table-fixed max-h-[70vh] md:max-w-none">
      <TableHeader>
        {/* Mono, uppercase, eyebrow tracking — DESIGN.md assigns exactly that
            to table headers, and the audit cells below already use it. The
            TableHead default is body-size sans, which made the strip the one
            place the register stepped outside its own world. */}
        <TableRow className="hover:bg-transparent [&>th]:font-mono [&>th]:text-eyebrow [&>th]:uppercase [&>th]:tracking-eyebrow">
          <TableHead className="w-8">
            <span className="sr-only">Condition marker</span>
          </TableHead>
          {/* `w-auto` below sm, not a percentage: under table-fixed the browser
              splits leftover width between the declared columns, which inflated
              the 32px marker column to ~124px on a phone and squeezed the
              deltas into truncation. */}
          <TableHead className="w-auto sm:w-[26%]">Skill</TableHead>
          <TableHead className="hidden sm:table-cell">Condition</TableHead>
          <TableHead className="hidden md:table-cell w-28">Audit</TableHead>
          <TableHead className="hidden sm:table-cell w-24 text-right">
            Added
          </TableHead>
          {editing ? (
            <TableHead className="w-10">
              <span className="sr-only">Remove</span>
            </TableHead>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {visible.map((row) => (
          <RegisterRowView
            key={`${row.skill.source}::${row.skill.skillId}`}
            row={row}
            pending={pending}
            actions={actions}
            columnCount={columnCount}
          />
        ))}
        {steady.length > 0 && !showSteady ? (
          <TableRow>
            <TableCell colSpan={columnCount} className="p-0">
              <button
                type="button"
                onClick={() => setShowSteady(true)}
                className="w-full cursor-pointer px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors duration-100 hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/50"
              >
                <span className="tabular-nums">{steady.length}</span> steady
                <span className="ml-2 text-muted-foreground/70">Show all</span>
              </button>
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}

function RegisterRowView<S extends RegisterSkill>({
  row,
  pending,
  actions,
  columnCount,
}: {
  row: RegisterRow<S>;
  pending: boolean;
  actions?: RegisterActions<S>;
  columnCount: number;
}) {
  void columnCount;
  const { skill, change, condition, status } = row;
  const isRemoved = status === "removed";
  const isAdded = status === "added";
  const meta = CONDITION_META[condition];
  // A steady marker is a claim. Do not make it before the data lands.
  const markerHidden = pending && condition === "steady";
  const delta =
    condition === "description"
      ? {
          before: change?.version?.descriptionBefore,
          after: change?.version?.descriptionAfter,
        }
      : null;
  const hasDelta = Boolean(delta?.before || delta?.after);

  return (
    <TableRow
      className={cn(
        condition === "steady" && "text-muted-foreground",
        // Staged rows stay in place and in order rather than jumping to a
        // pending group — you are meant to see the row you just acted on.
        //
        // The tint is what carries the state. The card grid this replaced used
        // an animated dashed border (`MarchingBorder`), which cannot sit on a
        // `<tr>` without an absolutely-positioned overlay; a tinted row is the
        // table's own way of saying the same thing and is legible at a glance
        // down a long list, which the border never was.
        //
        // Deliberately NOT faded: an earlier pass dimmed the whole row, which
        // dimmed the restore button with it (opacity cascades and a child
        // cannot opt out) and made the thing you were about to delete the
        // hardest thing to read. You need to read what you are removing.
        //
        // Applied to the CELLS with `!`, not to the row: TableBody paints body
        // cells via `[&_tr_td]:bg-surface-3`, a descendant selector that
        // outranks anything set on the `<tr>`, so a row-level background is
        // simply invisible. The file's own comment flags the same trap for its
        // selected-row style.
        status && "relative",
        // Opaque hover, overriding the Table component's `bg-surface-hover`.
        // That token is a ~6% translucent tint meant to LAYER on a surface, but
        // the component sets it as the cell's `background-color`, which
        // REPLACES the opaque cell fill — so the 6% composites over the
        // container's `bg-muted` instead of over the cell. The row then went
        // darker than the header strip in light mode and lighter than it in
        // dark, which is backwards in both. (bundle-card.tsx documents the same
        // trap for cards.) `surface-2` sits between the cell and the header
        // strip in both themes by construction.
        !status && "hover:[&>td]:bg-surface-2!",
        isRemoved &&
          "[&>td]:bg-danger/[0.10]! hover:[&>td]:bg-danger/[0.15]!",
        isAdded &&
          "[&>td]:bg-success/[0.10]! hover:[&>td]:bg-success/[0.15]!",
      )}
    >
      <TableCell className="align-top">
        {status ? (
          <MarchingBorder
            // `dash`/`gap` are percentages of the PERIMETER, so the card-sized
            // defaults stretch into long strokes around a wide, short table
            // row. Scaled down to keep the ant size roughly constant.
            dash={0.35}
            gap={0.3}
            strokeWidth={1.5}
            className={cn(
              "rounded-none",
              isRemoved ? "text-destructive/55" : "text-success-foreground/55",
            )}
          />
        ) : null}
        {markerHidden || !meta.icon ? null : (
          <HugeiconsIcon
            icon={meta.icon}
            strokeWidth={2}
            aria-hidden
            className={cn("mt-0.5 size-4", meta.tone)}
          />
        )}
      </TableCell>

      <TableCell className="align-top whitespace-normal">
        <Link
          href={skillHref(skill.source, skill.skillId)}
          className={cn(
            "group inline-flex items-center gap-1 rounded-sm font-medium text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50",
            isRemoved && "line-through",
          )}
        >
          {skill.name}
          {/* Before the chevron, not after. The chevron is the "open this"
              affordance and has to be the last thing in the row's reading
              order — with the badge behind it, it read as an arrow pointing at
              the badge rather than out of the row. */}
          {skill.curatedOwner ? (
            <OfficialBadge
              owner={skill.curatedOwner}
              className="[&_svg]:size-3.5"
            />
          ) : null}
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            strokeWidth={2}
            aria-hidden
            className="size-3.5 text-muted-foreground/50 transition-transform duration-100 group-hover:translate-x-0.5 motion-reduce:transition-none"
          />
        </Link>
        {status ? (
          <span className="sr-only">
            {status === "removed" ? "Removing" : "Adding"}
          </span>
        ) : null}
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
            pending={pending}
          />
        </div>
      </TableCell>

      <TableCell className="hidden sm:table-cell align-top whitespace-normal">
        <ConditionDetail
          condition={condition}
          label={meta.label}
          change={change}
          delta={hasDelta ? delta : null}
          pending={pending}
        />
      </TableCell>

      <TableCell className="hidden md:table-cell align-top">
        <AuditCell
          status={skill.worstAuditStatus}
          riskLevel={skill.worstAuditRiskLevel}
        />
      </TableCell>

      <TableCell className="hidden sm:table-cell align-top text-right text-xs tabular-nums text-muted-foreground">
        {isAdded ? (
          <span className="text-success-foreground">New</span>
        ) : skill.addedAt ? (
          timeAgo(skill.addedAt)
        ) : (
          "—"
        )}
      </TableCell>

      {actions ? (
        <TableCell className="align-top">
          <Button
            variant={isRemoved ? "primary-soft" : "ghost"}
            size="xs"
            className="-mr-1 size-7 p-0"
            aria-label={
              isRemoved ? `Restore ${skill.name}` : `Remove ${skill.name}`
            }
            onClick={() =>
              isRemoved ? actions.onRestore(skill) : actions.onRemove(skill)
            }
          >
            <HugeiconsIcon
              icon={isRemoved ? ArrowTurnBackwardIcon : Cancel01Icon}
              strokeWidth={2}
              aria-hidden
              className="size-3.5"
            />
          </Button>
        </TableCell>
      ) : null}
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
  pending,
}: {
  condition: Condition;
  label: string;
  change?: RegisterChange;
  delta: { before?: string; after?: string } | null;
  pending: boolean;
}) {
  // While pending, drop the CLAIM but keep the row's height. Returning nothing
  // here made every steady row grow when the query landed — on mobile the
  // condition lives inside the skill cell, so a 20-skill all-steady bundle (the
  // common case) jumped ~480px on resolve.
  const unresolvedSteady = pending && condition === "steady";
  return (
    <div className="mt-1 sm:mt-0">
      {condition === "steady" ? (
        <>
          {/* Steady still announces itself to a screen reader; it just does not
              spend a line of the reader's attention on every quiet row. */}
          <span className="sr-only">{unresolvedSteady ? "Checking" : label}</span>
          <span aria-hidden className="text-sm text-muted-foreground">
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

      {/* Named only when it disagrees with the condition above it. `delisted`
          and `fetch-error` outrank the change record, so a bare date under "No
          longer listed" reads as the date it was delisted when it is really the
          date of some unrelated content edit. When the two agree, the noun is
          just the label again and the date stands alone. */}
      {change ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {change.kind === condition
            ? timeAgo(change.changedAt)
            : `${CHANGE_NOUN[change.kind]} ${timeAgo(change.changedAt)}`}
        </p>
      ) : null}
    </div>
  );
}

/** What the change record's timestamp actually refers to. */
const CHANGE_NOUN: Record<RegisterChange["kind"], string> = {
  audit: "verdict changed",
  description: "description changed",
  content: "content edited",
};

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
      <span className="font-mono text-xs uppercase tracking-eyebrow text-muted-foreground">
        <span className="sr-only">Not audited</span>
        <span aria-hidden>&mdash;</span>
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
  pending,
  action,
}: {
  total: number;
  faults: number;
  changed: number;
  steady: number;
  /** The change data has not arrived yet. See the `pending` tone below. */
  pending: boolean;
  action?: React.ReactNode;
}) {
  // `pending` and `empty` are their own tones, and both used to resolve to
  // green. That was the worst defect in this component: with the change query
  // still in flight every row looks steady, so a bundle carrying a CRITICAL
  // regression painted a success light and the words "nothing changed" before
  // flipping to red. Volunteering an all-clear you have not verified is the one
  // failure mode a monitoring product cannot afford. An empty bundle was the
  // same mistake in a quieter key: nothing to report is not the same as fine.
  const tone: "pending" | "empty" | "clear" | "changed" | "fault" = pending
    ? "pending"
    : total === 0
      ? "empty"
      : faults > 0
        ? "fault"
        : changed > 0
          ? "changed"
          : "clear";

  const dot = {
    pending: "bg-muted-foreground animate-pulse motion-reduce:animate-none",
    empty: "bg-muted-foreground",
    clear: "bg-success-foreground",
    changed: "bg-warning-foreground",
    fault: "bg-danger-foreground",
  }[tone];
  const halo = {
    pending: "bg-muted-foreground/15",
    empty: "bg-muted-foreground/15",
    clear: "bg-success/20",
    changed: "bg-warning/20",
    fault: "bg-danger/20",
  }[tone];

  // The empty panel below states this in full; a tally echoing it directly
  // above is the same sentence twice.
  if (tone === "empty") return null;

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

      <p aria-live="polite" className="flex-1 text-sm">
        {tone === "pending" ? (
          <span className="text-muted-foreground tabular-nums">
            Checking {total} skill{total === 1 ? "" : "s"}&hellip;
          </span>
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
            <span className="whitespace-nowrap text-muted-foreground tabular-nums">
              {faults > 0 && changed > 0 ? `· ${changed} changed ` : ""}
              {/* A steady count only informs when there is a steady
                  population; "0 steady" is noise. */}
              {steady > 0 ? `· ${steady} steady` : ""}
            </span>
          </>
        )}
      </p>

      {action}
    </div>
  );
}
