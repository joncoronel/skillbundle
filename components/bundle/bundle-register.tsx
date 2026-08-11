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
 * STORY: The reader arrives asking "is my setup still OK?" and finds the answer
 * as structure — the register is sectioned by consequence (Needs attention,
 * Changed, Steady), each with a count, so the worst thing is the first row of
 * the first section rather than something to infer from an ordering.
 *
 * FIRST VIEWPORT: Bundle identity, then the section head carrying Install and
 * Edit skills, then the register's mono column strip and its first section.
 * Steady starts folded. The summary line above speaks only when the sections
 * cannot — while checking, and when everything is fine. The section is labelled
 * "Skills", not "Register": the register is the form, and naming the metaphor
 * at the reader is not the product's own language.
 *
 * FORM: Audit register. #2 on the ordered list; the roll assigned index 1 of 7
 * (seed key skillbundle-bundle-page-2026-08-08, dealt via the impeccable roll
 * API after the local renderer returned empty).
 *
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 * finish review, the verdict, and DESIGN.md.
 */

import { useId, useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon,
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
import {
  CONDITION_META,
  GROUP_LABEL,
} from "@/components/monitoring/condition-meta";
import { DescriptionDelta } from "@/components/monitoring/description-delta";
import {
  StatusLight,
  TONE_OF_GROUP,
} from "@/components/monitoring/status-light";
import {
  CONDITION_RANK,
  GROUP_OF,
  GROUP_ORDER,
  resolveCondition,
  type ChangeKind,
  type Condition,
  type GroupKey,
} from "@/lib/monitoring/conditions";
import { skillHref } from "@/lib/skill-urls";
import { cn, timeAgo } from "@/lib/utils";

export type { GroupKey };

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
  /** Absent on a fault row: the skill is wrong, but nothing happened to it. */
  kind?: ChangeKind;
  /** Null on a fault row — nothing records when a skill was delisted. */
  changedAt: number | null;
  audit?: { from: string; to: string; riskLevel?: string; changedAt: number };
  version: { descriptionBefore?: string; descriptionAfter?: string } | null;
};

export type RegisterRow<S extends RegisterSkill = RegisterSkill> = {
  skill: S;
  change?: RegisterChange;
  condition: Condition;
  /**
   * Staged but not yet saved. Only ever set when `buildRegister` was given a
   * status map, which only edit mode does — so this and `RegisterActions`
   * cannot get out of step.
   */
  status?: RegisterStatus;
};

export type RegisterStatus = "added" | "removed";

/** Edit-mode handlers. Their presence is what puts the register in edit mode. */
export type RegisterActions<S extends RegisterSkill = RegisterSkill> = {
  onRemove: (skill: S) => void;
  onRestore: (skill: S) => void;
};

/**
 * Build the register's rows and sections from a roster plus whatever the
 * archive reported.
 *
 * Generic over the caller's skill type rather than narrowing to
 * `RegisterSkill`: the bundle page feeds the consequence-ordered rows straight
 * back into its edit mode, which needs the full skill object, and a widened
 * return type would have forced a cast there.
 *
 * `statusByKey` is a parameter rather than something the caller re-attaches
 * afterwards. Edit mode used to call this, throw away the grouping, re-map
 * every row to add its staged status, and then regroup — which meant a second
 * exported helper existed only to patch the gap, and the two paths could
 * silently disagree about ordering the moment either was edited.
 */
export function buildRegister<S extends RegisterSkill>(
  skills: S[],
  changes: RegisterChange[] | undefined,
  statusByKey?: Map<string, RegisterStatus>,
): {
  rows: RegisterRow<S>[];
  groups: Array<{ key: GroupKey; rows: RegisterRow<S>[] }>;
  faults: number;
  changed: number;
} {
  const byKey = new Map((changes ?? []).map((c) => [c.key, c]));

  const rows: RegisterRow<S>[] = skills.map((skill) => {
    const key = `${skill.source}::${skill.skillId}`;
    const change = byKey.get(key);
    return {
      skill,
      change,
      condition: resolveCondition(skill, change?.kind),
      status: statusByKey?.get(key),
    };
  });

  // Consequence first, then recency, then name — so the order is stable for
  // the long tail of steady rows that share a rank.
  rows.sort(
    (a, b) =>
      CONDITION_RANK[b.condition] - CONDITION_RANK[a.condition] ||
      (b.change?.changedAt ?? 0) - (a.change?.changedAt ?? 0) ||
      a.skill.name.localeCompare(b.skill.name),
  );

  // Section the rows, preserving consequence order inside each — so the worst
  // item is still the first row of the first section.
  const groups = GROUP_ORDER.map((key) => ({
    key,
    rows: rows.filter((r) => GROUP_OF[r.condition] === key),
  })).filter((g) => g.rows.length > 0);

  const counts = { attention: 0, changed: 0, steady: 0 };
  for (const r of rows) counts[GROUP_OF[r.condition]]++;

  return {
    rows,
    groups,
    faults: counts.attention,
    changed: counts.changed,
  };
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
  groups,
  actions,
}: {
  groups: Array<{ key: GroupKey; rows: RegisterRow<S>[] }>;
  actions?: RegisterActions<S>;
}) {
  const editing = actions !== undefined;

  // Steady starts folded. On a healthy bundle it holds every row, and forty
  // rows of em-dash is the version of "calm" that reads as "empty" — but
  // hiding the inventory outright would cost the reader their sense of what
  // they have, so it folds behind its own labelled count rather than
  // disappearing. The other two sections start open: they exist only when
  // there is something in them.
  //
  // Nothing is folded in edit mode. There you are managing the inventory, not
  // triaging it, and a hidden row cannot be removed.
  const [collapsed, setCollapsed] = useState<Set<GroupKey>>(
    () => new Set<GroupKey>(["steady"]),
  );
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
      {/*
        One `<tbody>` PER SECTION, not one for the whole table.

        A tbody is a rowgroup, so `aria-labelledby` on it is what tells a screen
        reader that this row is inside "Needs attention". Previously the section
        head was a `<td colSpan>` — a DATA cell, announced as a value, with no
        programmatic relationship to the rows under it. The grouping that is the
        entire point of the redesign existed visually only.

        The cost is the component's corner rounding, which is scoped
        `tr:first-child` / `tr:last-child` WITHIN a tbody and so would round
        every section boundary into a seam. Reset it on all four corners and
        re-apply on the outer edges of the first and last section.
      */}
      {groups.map((group, i) => {
        const open = editing || !collapsed.has(group.key);
        return (
          <RegisterGroup
            key={group.key}
            group={group.key}
            rows={group.rows}
            open={open}
            actions={actions}
            columnCount={columnCount}
            isFirst={i === 0}
            isLast={i === groups.length - 1}
            // Sections are fixed open while editing; a fold that cannot be
            // unfolded is a control that lies.
            onToggle={
              editing
                ? undefined
                : () =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.key)) next.delete(group.key);
                      else next.add(group.key);
                      return next;
                    })
            }
          />
        );
      })}
    </Table>
  );
}

/**
 * One section: its header row and its rows, as a single labelled rowgroup.
 *
 * All sections share one `<table>` so the columns stay aligned down the whole
 * register — the reader is comparing conditions across sections, and three
 * tables would each size their columns independently.
 */
function RegisterGroup<S extends RegisterSkill>({
  group,
  rows,
  open,
  actions,
  columnCount,
  isFirst,
  isLast,
  onToggle,
}: {
  group: GroupKey;
  rows: RegisterRow<S>[];
  open: boolean;
  actions?: RegisterActions<S>;
  columnCount: number;
  isFirst: boolean;
  isLast: boolean;
  onToggle?: () => void;
}) {
  const labelId = useId();
  const bodyId = useId();

  const content = (
    <span className="flex items-center gap-2">
      {onToggle ? (
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          strokeWidth={2}
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-100 motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
      ) : (
        <span aria-hidden className="size-3.5 shrink-0" />
      )}
      <StatusLight tone={TONE_OF_GROUP[group]} className="size-4" />
      <span id={labelId} className="text-sm font-medium text-foreground">
        {GROUP_LABEL[group]}
      </span>
      <span className="text-sm tabular-nums text-muted-foreground">
        {rows.length}
      </span>
    </span>
  );

  return (
    <TableBody
      id={bodyId}
      aria-labelledby={labelId}
      className={cn(
        // Neutralise the per-tbody rounding, then restore only the register's
        // real outer corners. See the comment at the call site.
        "[&_tr:first-child_td:first-child]:rounded-none [&_tr:first-child_td:last-child]:rounded-none",
        "[&_tr:last-child_td:first-child]:rounded-none [&_tr:last-child_td:last-child]:rounded-none",
        isFirst &&
          "[&_tr:first-child_td:first-child]:rounded-tl-lg [&_tr:first-child_td:last-child]:rounded-tr-lg",
        isLast &&
          "[&_tr:last-child_td:first-child]:rounded-bl-lg [&_tr:last-child_td:last-child]:rounded-br-lg",
      )}
    >
      <TableRow className="[&>td]:bg-muted/60!">
        <TableCell colSpan={columnCount} className="p-0">
          {onToggle ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              aria-controls={bodyId}
              className="w-full cursor-pointer px-3 py-2 text-left transition-colors duration-100 hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/50"
            >
              {content}
            </button>
          ) : (
            <div className="px-3 py-2">{content}</div>
          )}
        </TableCell>
      </TableRow>
      {open
        ? rows.map((row) => (
            <RegisterRowView
              key={`${row.skill.source}::${row.skill.skillId}`}
              row={row}
              actions={actions}
            />
          ))
        : null}
    </TableBody>
  );
}

function RegisterRowView<S extends RegisterSkill>({
  row,
  actions,
}: {
  row: RegisterRow<S>;
  actions?: RegisterActions<S>;
}) {
  const { skill, change, condition, status } = row;
  const isRemoved = status === "removed";
  const isAdded = status === "added";
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
        // Full-strength tokens, NOT an alpha step of them. `--danger` and
        // `--success` are already the tinted BACKGROUND tokens (near-white in
        // light, near-black in dark), so the 10% these carried composited to
        // under 1.01:1 against the cell fill — invisible in both themes, which
        // left the comment above claiming a signal that was not being rendered.
        // The alpha step belongs on hover, where it is a delta from something
        // visible rather than a delta from nothing.
        isRemoved && "[&>td]:bg-danger! hover:[&>td]:bg-danger/70!",
        isAdded && "[&>td]:bg-success! hover:[&>td]:bg-success/70!",
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
        {!meta.icon ? null : (
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
          just the label again and the date stands alone.

          Both guards are load-bearing: a fault row carries no `kind` and no
          `changedAt`, and there is no honest time to print for one. */}
      {change?.kind && change.changedAt !== null ? (
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
const CHANGE_NOUN: Record<ChangeKind, string> = {
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
  suppressed = false,
}: {
  total: number;
  faults: number;
  changed: number;
  /**
   * The mass-change breaker tripped. The dashboard was the only surface wired
   * to it, so a catalog-wide reprocess produced "holding these back" on the
   * home page and a flat "Changed" on forty rows one click away — half the
   * product asserting what the other half had just declined to.
   */
  suppressed?: boolean;
}) {
  // `empty` is its own tone rather than resolving to green: nothing to report
  // is not the same as fine.
  //
  // There used to be a `pending` tone here too, for the window where the change
  // query was still in flight — every row looks steady until it lands, so a
  // bundle carrying a CRITICAL regression painted a success light and the words
  // "nothing changed" before flipping to red. Volunteering an all-clear you
  // have not verified is the one failure mode a monitoring product cannot
  // afford.
  //
  // That window no longer exists: the change list is preloaded on the server
  // (see the `preloadQuery` in app/(main)/bundle/[id]/page.tsx), so this
  // component never renders before the data. The rule still stands — if this is
  // ever fed from a client fetch again, the unverified state needs its own tone
  // before anything green can render.
  // Suppression is NOT a tone. It used to be one, ranked below `fault`, so a
  // single delisted skill swallowed the caveat entirely: one fault plus forty
  // suppressed changes rendered no hold notice at all, while the dashboard one
  // click away said "holding these back". The two are orthogonal — a fault is
  // something that IS wrong, suppression is doubt about the change list — so
  // the caveat renders alongside whatever tone the light is showing.
  const tone: "empty" | "clear" | "changed" | "fault" =
    total === 0
      ? "empty"
      : faults > 0
        ? "fault"
        : changed > 0
          ? "changed"
          : "clear";

  // The empty panel below states this in full; a tally echoing it directly
  // above is the same sentence twice. Nothing to announce either — there is no
  // verdict, and the panel is not a status readout.
  if (tone === "empty") return null;

  // VISUALLY silent unless it has something the sections cannot say. With a
  // fault or a change present, each section header already carries a dot beside
  // the rows it describes, so a summary line repeating them is a second voice
  // saying the same thing.
  //
  // The LIVE REGION is not silent, and that distinction is the fix here. This
  // component used to `return null` for exactly the fault and changed tones,
  // which removed the region from the DOM rather than updating it — and a
  // removed live region never announces. So a screen-reader user was told
  // "Checking 14 skills…" and then told the result only when the result was
  // good. The announcement worked precisely when the news did not matter.
  const visible = tone === "clear" || suppressed;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {visible ? (
        <StatusLight
          tone={suppressed ? "hold" : TONE_OF_GROUP.steady}
        />
      ) : null}

      {/*
        No breakdown here any more. The register groups into the same three
        sections this used to count, each with its own dot and number, so a
        tally reading "1 needs attention · 2 changed · 10 steady" directly above
        headers saying exactly that was the same sentence twice.

        What the sections cannot say is the healthy verdict: a lone collapsed
        "Steady 13" is an inventory label, not the reassurance PRODUCT.md
        principle 3 asks for.
      */}
      <p aria-live="polite" className="flex-1 text-sm">
        <>
            {/* The verdict. Visible only when it says something the sections
                cannot; otherwise `sr-only`, so the live region stays mounted
                and actually fires. */}
            {tone === "clear" && !suppressed ? (
              <>
                <span className="font-medium">All steady.</span>{" "}
                <span className="text-muted-foreground tabular-nums">
                  {total} skill{total === 1 ? "" : "s"}, nothing changed since
                  you added them.
                </span>
              </>
            ) : (
              <span className="sr-only">
                {[
                  faults > 0 ? `${faults} need attention` : null,
                  changed > 0 ? `${changed} changed` : null,
                ]
                  .filter(Boolean)
                  .join(", ") || "All steady"}
                .
              </span>
            )}

            {/* Additive, not an alternative. Renders whatever else is true —
                including alongside a fault, which is the case that used to
                lose it entirely. */}
            {suppressed ? (
              <span className="text-muted-foreground">
                A large share of the catalog changed at once, which usually
                means we reprocessed content rather than authors editing it.
                Read these rows with that in mind.
              </span>
            ) : null}
        </>
      </p>
    </div>
  );
}
