import Link from "next/link";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  ArrowDataTransferHorizontalIcon,
  ArrowRight01Icon,
  CheckmarkCircle01Icon,
  GitForkIcon,
  Location01Icon,
} from "@hugeicons/core-free-icons";
import { SkillSection } from "@/components/skill-section";
import { skillHref } from "@/lib/skill-urls";
import { cn, formatInstalls } from "@/lib/utils";

export type CopyKind = "self" | "current-name" | "former-name" | "other-repo";

export type CopyEntry = {
  source: string;
  skillId: string;
  installs: number;
  kind: CopyKind;
};

export const COPIES_SECTION = {
  id: "copies",
  title: "Copies",
  // The tab strip names this pane; the summary line reports the split instead
  // of repeating the word. See SkillSection.
  titleHidden: true,
  rule: false,
  description:
    "The same skill content is published in more than one place. Installs are counted per repo, so no single number here is the whole picture. Any of these install commands works.",
} as const;

/**
 * The Copies tab: every place this skill's content is published, ranked by
 * install count, with the page you are on sitting among them.
 *
 * It used to be an "Also available at" section on the Overview, above the
 * SKILL.md. On a skill with ten copies that was 649px of reference material
 * standing between the install command and the document, so it moved to its
 * own route. The tab only exists for skills that have copies, which is a small
 * minority: an always-present tab reading "published in one place" on most of
 * the catalog is chrome, and the tab appearing at all is itself the signal.
 *
 * ONE ranked list, not the two labelled groups this replaced. The section's own
 * caption always claimed the install counts are split across these repos, and
 * then showed a flat list where that claim was invisible: on
 * `whytryharder/superpowers` the page you land on reports 113.7k while the
 * repo's current name carries 1.7M. Splitting the rows into "other names" and
 * "other repos" put those two numbers in different lists and made them
 * incomparable, which is the one comparison this page exists to make. Ranking
 * everything together answers "which copy does the ecosystem actually use" in a
 * glance; the rename-versus-fork distinction survives as a labelled glyph in
 * its own column, where it reads as metadata rather than competing with the
 * repo name for the row's attention.
 */
/**
 * The section's identity, shared with the tab's skeleton so a wording change
 * cannot land on one and not the other. They stood as two identical
 * 180-character copies of the same description.
 */
export function SkillCopies({
  entries,
  className,
}: {
  entries: CopyEntry[];
  className?: string;
}) {
  const ranked = entries.toSorted((a, b) => b.installs - a.installs);
  const total = ranked.reduce((sum, c) => sum + c.installs, 0);
  // The bar is proportional to the LEADER, not to the total. Against the total
  // a ten-way split draws ten slivers and reads as noise; against the leader
  // the shape of the split is the point, and the leader's full-width bar is the
  // answer to "which one should I depend on".
  const max = Math.max(...ranked.map((c) => c.installs), 1);

  return (
    <SkillSection
      {...COPIES_SECTION}
      summary={
        <p className="text-sm font-medium text-foreground">
          {formatInstalls(total)} installs across {ranked.length}{" "}
          {ranked.length === 1 ? "place" : "places"}
        </p>
      }
      className={className}
    >
      <ul>
        {ranked.map((copy) => (
          <CopyRow
            key={`${copy.source}/${copy.skillId}`}
            copy={copy}
            max={max}
          />
        ))}
      </ul>
    </SkillSection>
  );
}

const KIND_META: Record<CopyKind, { label: string; icon: IconSvgElement }> = {
  self: { label: "This page", icon: Location01Icon },
  "current-name": { label: "Current name", icon: CheckmarkCircle01Icon },
  "former-name": {
    label: "Former name",
    icon: ArrowDataTransferHorizontalIcon,
  },
  "other-repo": { label: "Other repo", icon: GitForkIcon },
};

function CopyRow({ copy, max }: { copy: CopyEntry; max: number }) {
  const share = Math.max((copy.installs / max) * 100, 1.5);
  const isSelf = copy.kind === "self";
  const kind = KIND_META[copy.kind];

  const body =
    (
      /**
       * Four columns at `sm` and up: repo, kind, bar, count. The bar sits BETWEEN
       * the name and the number rather than under them, and that is what lets the
       * row span the full pane. Capped at a reading measure this list looked
       * stranded on the left; run edge to edge with the bar under the text, the
       * repo and its count sat ~900px apart with nothing between them and stopped
       * reading as one row. The bar in the middle is what connects them, and it
       * gains resolution as the viewport widens instead of gaining dead space.
       *
       * On mobile the bar drops to its own full-width line under the pair
       * (`order-last` plus `col-span-2`), because a bar sharing a 390px row with
       * two labels is too short to read as a measurement.
       */
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2.5 sm:grid-cols-[minmax(0,17rem)_8.5rem_minmax(0,1fr)_auto]">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "truncate font-mono text-sm text-foreground",
              isSelf && "font-medium",
            )}
          >
            {copy.source}
          </span>
          {/* The kind rides beside the name on mobile, where its own column is
            hidden. Same words, same glyph, no background either way. */}
          <span className="flex shrink-0 items-center gap-1 text-(length:--text-micro) text-muted-foreground sm:hidden">
            <HugeiconsIcon
              icon={kind.icon}
              strokeWidth={2}
              className="size-3"
            />
            {kind.label}
          </span>
        </span>

        {/* Metadata weight, deliberately. These labels were pill-shaped chips
          with a filled background, which put them at the same visual level as
          the repo name they annotate. A glyph and 11px muted text reads as a
          column entry for that row instead of as a badge on it. */}
        <span
          className={cn(
            "hidden items-center gap-1.5 text-(length:--text-micro) sm:flex",
            isSelf ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <HugeiconsIcon
            icon={kind.icon}
            strokeWidth={2}
            className="size-3.5 shrink-0"
          />
          {kind.label}
        </span>

        <span className="order-last col-span-2 h-1.5 w-full overflow-hidden rounded-full bg-muted sm:order-none sm:col-span-1">
          {/* The row the reader is on takes the foreground tone; every other bar
            is neutral. No bar is blue: the accent belongs on a destination,
            not on the place they already are. */}
          <span
            className={cn(
              "block h-full rounded-full",
              isSelf ? "bg-foreground/70" : "bg-neutral/45",
            )}
            style={{ width: `${share}%` }}
          />
        </span>

        <span className="flex shrink-0 items-center justify-end gap-1.5 text-xs text-muted-foreground tabular-nums">
          {formatInstalls(copy.installs)} installs
          {/* Reserved rather than removed on the current row, so every count in
            the column lands on the same right edge. */}
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            strokeWidth={2}
            className={cn(
              "size-3.5 transition-transform",
              isSelf
                ? "invisible"
                : "text-muted-foreground/60 group-hover:translate-x-0.5 group-hover:text-foreground",
            )}
          />
        </span>
      </div>
    );

  return (
    <li>
      {isSelf ? (
        // Not a link: it is the page the reader is standing on. Padded to the
        // same box as its neighbours so the ranking stays one column.
        <div className="-mx-3 rounded-lg px-3 py-3.5">{body}</div>
      ) : (
        <Link
          href={skillHref(copy.source, copy.skillId)}
          className="group -mx-3 block rounded-lg px-3 py-3.5 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50"
        >
          {body}
        </Link>
      )}
    </li>
  );
}
