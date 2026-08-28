"use client";

import { useMemo, useRef, useState } from "react";
import NumberFlow from "@number-flow/react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  ArrowUpRight01Icon,
  StarIcon,
} from "@hugeicons/core-free-icons";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/cubby-ui/dialog";
import { OfficialBadge } from "@/components/skill-badges";
import {
  AuditAccordion,
  AuditBadge,
  worstAuditStatus,
  type SkillAuditEntry,
} from "@/components/skill-audit-section";
import { InstallChart } from "@/components/skill-install-chart";
import {
  InstallSparkline,
  InstallSparklineGhost,
} from "@/components/skill-install-sparkline";
import {
  MIN_POINTS,
  intFmt,
  weekGain,
  weekWindow,
  type SkillInsights,
  type SparklineHoverState,
} from "@/components/skill-chart-shared";
import { cn, formatInstalls } from "@/lib/utils";

/**
 * The card's own chrome, exported because the page's loading skeleton draws the
 * same container and used to hand-copy this string 500 lines away in another
 * file. Retune the surface here and the skeleton follows.
 */
export const RECORD_SURFACE =
  "rounded-2xl bg-surface-3 shadow-[var(--surface-shadow-1),var(--surface-rim-1)]";

/**
 * Everything SkillBundle knows about a skill, as one panel in the sidebar.
 *
 * This started as a full-width strip under the title and was wrong there for a
 * reason worth recording, because it is not obvious until you see it with real
 * content: a skill description is a paragraph capped at a readable measure, so
 * beside it roughly 45% of a 1152px page is empty — and a long description
 * (`agent-browser` runs to 13 lines) turns that into a 500px column of nothing.
 * Filling it with a four-cell stat strip made it worse, not better: at ~280px
 * per cell, a skill with no rank and no weekly gain showed two big dashes and
 * two explanatory notes, which reads as broken rather than as unknown.
 *
 * Narrow fixes both. The facts stack into label/value rows where a missing
 * value is a short phrase ("Not ranked") instead of a dash marooned in a wide
 * cell, and the panel occupies the space the lead was never going to use.
 *
 * It is the ONE card on the page, and that is the rule rather than a
 * coincidence: this panel is the only genuinely object-like thing here — a
 * fixed instrument readout — while everything else, including the SKILL.md, is
 * text flowing down a column. A card was tried on the document and abandoned
 * for a reason that does not apply here: a card announces its edges, and a
 * 20,000px document has no edge on screen for almost the whole time you are
 * inside it. A ~400px sidebar panel is exactly the size where the device works,
 * because all four edges are visible at once.
 *
 * `surface-3` at `shadowLevel` 1, matching the Card default — a tonal lift and
 * a hairline ring, no drop shadow. Depth declared once (DESIGN.md §6), so do
 * not add a border back on top of it.
 *
 * Every block inside it names one subject and holds only facts about that
 * subject: the install total owns its trailing-week delta and its trend line,
 * the repository owns its star count. An earlier version had a fourth block
 * with no subject at all — a bare list of three measurements between Installs
 * and Repository — and it showed: the delta sat away from the number it was a
 * delta OF, and the star count needed the caption "on the source repo" to say
 * what it counted. A caption explaining what a row is doing there is the
 * grouping asking to be fixed.
 *
 * `action` is the exception to that rule, and it earns it. The Add-to-bundle
 * button used to sit above the card as a separate element of exactly the same
 * width, which is the one arrangement that reads as a mistake: two objects that
 * agree on every dimension but do not touch look like one object that came
 * apart, not like two things. Inside, it is the card's first block, divided by
 * the same hairline as every other, and the sidebar becomes a single object —
 * this is the skill, take it, here is what we know about it. The card was
 * already not a pure readout; View trend, Verdicts and History are all controls
 * within it.
 *
 * ── Why everything below the action collapses ─────────────────────────────
 *
 * The page has two phases and they never overlap. Deciding — masthead through
 * History — is when these facts are worth their space and navigation is worth
 * nothing, because the reader has not entered the document. Reading is the
 * reverse: the outline earns the column and an install count does not, since
 * the decision it informs has already been made. Only the action spans both.
 *
 * So the card is the full record until the reader reaches the SKILL.md, then
 * folds to just its action and hands the column to the rail. That is what lets
 * ONE 272px column do the job two columns were doing: 435px of card plus 695px
 * of rail does not fit in a 900px viewport, and 56px plus 695px does. The old
 * layout bought that space by widening the whole page to 92rem, which only
 * worked past ~1400px and cost the document 120px at the very breakpoint where
 * the rail appeared.
 *
 * The trigger is a boundary, not a distance — `#documentation` crossing the
 * same line the rail's scroll spy reads — so the fold lands at a moment the
 * reader can feel rather than after some number of pixels.
 *
 * Install rank is deliberately absent. It is still loaded (the install chart
 * reads the same `insights` object) but it answers a leaderboard question
 * rather than a "should I depend on this" one, and beside a raw install count
 * it was the weaker of two numbers saying roughly the same thing.
 */
export function SkillRecord({
  source,
  skillId,
  externalUrl,
  externalIcon,
  externalLabel,
  curatedOwner,
  insights,
  updatedKind,
  updatedDate,
  audits,
  stars,
  action,
  collapsed = false,
  className,
}: {
  source: string;
  skillId: string;
  externalUrl: string;
  externalIcon: IconSvgElement;
  externalLabel: string;
  curatedOwner?: string;
  insights: SkillInsights;
  updatedKind: string;
  updatedDate: string;
  audits: SkillAuditEntry[] | null;
  stars: number | null;
  /** The primary action, rendered as the card's first block. */
  action?: React.ReactNode;
  /**
   * Fold everything below the action away. The caller owns this because the
   * card cannot know whether it is the sticky sidebar of a long document or a
   * block in a stacked column — see the header comment for when it is true.
   */
  collapsed?: boolean;
  className?: string;
}) {
  const { snapshots, installs } = insights;
  const hasChart = snapshots.length >= MIN_POINTS;
  const gain = weekGain(snapshots);
  // Same trailing-week window the "Past 7 days" row counts from, so the line's
  // leftmost point is exactly that row's baseline and the two cannot drift.
  // Memoized because the sparkline reports the hovered day back to `setHover`
  // below, and that re-renders this component. `weekWindow` returns a fresh
  // slice each call, so without this the chart re-renders on every hover, which
  // re-pushes its props to the chart host and cancels the focus dot's animation
  // mid-flight — the dot then jumps instead of travelling.
  const sparkPoints = useMemo(() => weekWindow(snapshots), [snapshots]);

  // Hovering the sparkline scrubs the install total. The scrub stays inside the
  // installs block — the value rolls and the label becomes the date — so no
  // neighbouring row is left quietly describing a different day.
  const [hover, setHover] = useState<SparklineHoverState>(null);
  const chartDialogRef = useRef<HTMLDivElement | null>(null);

  return (
    <div className={cn(RECORD_SURFACE, className)}>
      {/* `px-4`, the same inset as every block below, so the button's edges sit
          on the same two lines as the labels and values it caps. `p-3` was the
          alternative and it looked like a lid rather than the top of the
          object. */}
      {action && <div className="px-4 py-3">{action}</div>}

      {/* Same collapse as the header menu and the section rail — 0fr → 1fr, one
          curve, `visibility` for the closed state. header-pill.tsx has the
          measurements for why it's `visibility` and not `display: none`/`inert`.

          `visibility` matters more here than there: a clipped block stays in the
          tab order, and tabbing into a zero-height container scrolls it into
          view. This card collapses on SCROLL, so that would drag it open
          unprompted while somebody reads.

          `divide-y` moved off the card root and onto this group, with the
          matching `border-t` — on the root, the divider between the action and
          a zero-height group rendered as a stray hairline pinned to the card's
          bottom edge. */}
      <div
        className={cn(
          "grid transition-[grid-template-rows,visibility] duration-400 ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none",
          collapsed ? "invisible grid-rows-[0fr]" : "visible grid-rows-[1fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={cn(
              "divide-y divide-border",
              action && "border-t border-border",
            )}
          >
            <div className="px-4 py-4">
              <p
                className={cn(
                  "text-xs font-medium text-muted-foreground",
                  hover && "tabular-nums",
                )}
              >
                {hover ? formatDay(hover.day) : "Installs"}
              </p>

              {/* min-h reserves NumberFlow's animated height — the digit-roll mask
            adds ~8px the first time it runs — so the sparkline never shifts. */}
              <div className="mt-1.5 flex min-h-9 items-center">
                {hover || installs != null ? (
                  <NumberFlow
                    value={hover ? hover.value : (installs as number)}
                    format={{ notation: "compact", maximumFractionDigits: 1 }}
                    className="text-2xl leading-none font-semibold text-foreground"
                    aria-label={`${hover ? hover.value : installs} installs`}
                  />
                ) : (
                  // `installs` is null only for an orphaned row. A dash, never a zero:
                  // a wrong number reads as fact, in the accessible name as much as
                  // on screen.
                  <span
                    className="text-2xl leading-none font-semibold text-muted-foreground"
                    aria-label="Install count unavailable"
                  >
                    —
                  </span>
                )}
              </div>

              {/* The delta belongs to the number above it, not to a list of loose
            measurements. It sits between the total and the chart so the two
            figures read together and the sparkline below illustrates them
            both. It stays put during a sparkline scrub, correctly: it is a
            fixed trailing-window stat, not a value for the hovered day. */}
              <dl className="mt-2">
                <FactRow label="Past 7 days">
                  {gain != null ? (
                    <Value className="text-success-foreground">
                      +{intFmt(gain)}
                    </Value>
                  ) : (
                    <Value muted>No change</Value>
                  )}
                </FactRow>
              </dl>

              {hasChart ? (
                <Dialog>
                  <div className="mt-3">
                    <InstallSparkline points={sparkPoints} onHover={setHover} />
                  </div>
                  <DialogTrigger
                    render={
                      <button
                        type="button"
                        className="mt-1.5 inline-flex items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50"
                      />
                    }
                  >
                    View trend
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      strokeWidth={2}
                      className="size-3"
                    />
                  </DialogTrigger>
                  {/* The chart's SVG is keyboard-navigable, so it is the first
                      tabbable node in the popup and would otherwise take the
                      dialog's opening focus — which selects a point and opens a
                      tooltip before the reader has done anything. Focus the
                      popup instead; Tab still reaches the chart. The popup is
                      only a focus landing spot, so it draws no ring of its own;
                      the dialog is already announced as one. */}
                  {/* The scale is dropped from this dialog's transition on
                      purpose, and it is load-bearing — do not restore it
                      without reading docs/charts.md. TanStack Charts measures
                      its container with `getBoundingClientRect`, which carries
                      an ancestor transform: opened with the default
                      `scale-95`, the chart lays its scene out at 95% of the
                      real width, paints every scene unit 5% oversized, and has
                      no way to notice (a transform fires no ResizeObserver).
                      Translate and opacity leave a box's measured width alone,
                      so this entrance is the one shape the chart can be
                      measured through. It is also what lets the chart use the
                      library's own entrance rather than a CSS stand-in; see
                      `chartMotionEntrance`. */}
                  <DialogContent
                    className="focus-visible:outline-none data-ending-style:scale-100 data-starting-style:scale-100 sm:max-w-2xl"
                    initialFocus={chartDialogRef}
                    ref={chartDialogRef}
                  >
                    <DialogHeader>
                      <DialogTitle>Installs over time</DialogTitle>
                      <DialogDescription>
                        Cumulative total and daily installs, recorded once a
                        day.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogBody>
                      <InstallChart insights={insights} />
                    </DialogBody>
                  </DialogContent>
                </Dialog>
              ) : (
                // Pre-chart state: a ghost line fading into the history not yet
                // recorded, so it reads as a placeholder rather than a flat trend.
                <div className="mt-3">
                  <InstallSparklineGhost />
                  <p className="mt-2 text-xs text-muted-foreground">
                    Recording daily. The trend appears once there&apos;s enough
                    history.
                  </p>
                </div>
              )}
            </div>

            <div className="px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground">
                Repository
              </p>
              <a
                href={externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group mt-1.5 flex max-w-full min-w-0 items-center gap-1.5 text-sm text-foreground transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50"
              >
                <HugeiconsIcon
                  icon={externalIcon}
                  strokeWidth={2}
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
                <span className="truncate group-hover:underline">
                  {externalLabel}
                </span>
                {curatedOwner && <OfficialBadge owner={curatedOwner} />}
                <HugeiconsIcon
                  icon={ArrowUpRight01Icon}
                  strokeWidth={2}
                  className="size-3 shrink-0 text-muted-foreground/70"
                />
              </a>

              {/* Stars as a meta line under the repo, the way a repo is captioned
            everywhere a developer already reads one — glyph, then count, no
            label. A labelled `GitHub stars … 40.5k` row said "GitHub" twice
            (the repo link above it carries the mark) and set a secondary fact
            in the same weight as the primary ones. The star does the naming,
            which is what an icon this well known is for; the accessible name
            still spells it out, because a glyph is not a word. */}
              {stars != null && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <HugeiconsIcon
                    icon={StarIcon}
                    strokeWidth={2}
                    className="size-3.5 shrink-0"
                  />
                  {/* `text-box` trim: the digits' line box carries half-leading and
                descender space the star icon does not, which dropped the number
                ~0.5px below the glyph's optical centre. Trimming to the cap and
                alphabetic edges lines the two up on what the eye actually
                sees. */}
                  <span className="font-medium text-foreground tabular-nums [text-box:trim-both_cap_alphabetic]">
                    {formatInstalls(stars)}
                  </span>
                  <span className="sr-only">GitHub stars</span>
                </p>
              )}
            </div>

            {audits && audits.length > 0 && (
              <div className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    Security
                  </p>
                  <AuditBadge status={worstAuditStatus(audits)} />
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-3">
                  <span className="text-sm text-foreground">
                    {audits.length === 1
                      ? audits[0].provider
                      : `${audits.length} providers`}
                  </span>
                  <Dialog>
                    <DialogTrigger
                      render={
                        <button
                          type="button"
                          className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50"
                        />
                      }
                    >
                      Verdicts
                      <HugeiconsIcon
                        icon={ArrowRight01Icon}
                        strokeWidth={2}
                        className="size-3"
                      />
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-lg">
                      <DialogHeader>
                        <DialogTitle>Security audits</DialogTitle>
                        <DialogDescription>
                          Independent checks from skills.sh&apos;s audit
                          partners.
                        </DialogDescription>
                      </DialogHeader>
                      <DialogBody>
                        <AuditAccordion
                          source={source}
                          skillId={skillId}
                          audits={audits}
                        />
                      </DialogBody>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            )}

            <div className="px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground">
                {updatedKind}
              </p>
              <div className="mt-1.5 flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">{updatedDate}</span>
                <a
                  href="#history"
                  className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50"
                >
                  History
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    strokeWidth={2}
                    className="size-3"
                  />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FactRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Value({
  children,
  muted,
  className,
}: {
  children: React.ReactNode;
  muted?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-sm font-medium tabular-nums",
        muted ? "text-muted-foreground" : "text-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** "2026-05-30" → "May 30, 2026" (UTC noon so the label never slips a day). */
function formatDay(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
