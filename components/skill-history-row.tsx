"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";

import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/cubby-ui/badge";
import { Button } from "@/components/ui/cubby-ui/button";
import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/cubby-ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/cubby-ui/select";
import { DotMatrixRipple } from "@/components/ui/dot-matrix-ripple";
import { cn, formatDate, timeAgo } from "@/lib/utils";

/**
 * The interactive half of the History section.
 *
 * Split out from skill-history.tsx so the list itself can be a Server Component:
 * the rows are the only part that needs state (open/collapsed, which version to
 * compare against), and keeping them here lets the surrounding timeline render
 * on the server and land in the page's cached HTML.
 */

/**
 * Still loaded on demand. See the header of skill-history-diff.tsx: it pulls the
 * full shiki bundle plus a second @shikijs/core, and only matters once someone
 * actually expands a row. `ssr: false` because the renderer draws into a shadow
 * root and has nothing to contribute to the server HTML.
 */
const VersionDiff = dynamic(
  () => import("./skill-history-diff").then((m) => m.VersionDiff),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
        <DotMatrixRipple className="size-4" />
        Loading diff
      </div>
    ),
  },
);

export type VersionEntry =
  (typeof api.skillVersions.listForSkill)["_returnType"][number];

export function HistoryRow({
  version,
  previous,
  olderVersions,
}: {
  version: VersionEntry;
  previous: VersionEntry | undefined;
  /** Present only on the newest row: everything it can be compared back to. */
  olderVersions: VersionEntry[] | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [againstId, setAgainstId] = useState<string | undefined>(
    previous?.versionId,
  );

  // The oldest row has no stored predecessor, so there is nothing to diff it
  // against. Deliberately NOT rendered as an all-additions diff: that would
  // claim the whole file was written that day, when the truth is only that this
  // is where our record starts.
  const isAnchor = version.isBaseline || !previous;

  /**
   * A lookback range belongs on the NEWEST row only, and this is a correction of
   * an earlier design that put "Everything since" on every older row.
   *
   * "How far back do I want to look?" is a question asked from the present. Hung
   * off each historical row instead, it produced one redundant framing per row:
   * on the second-newest entry, "everything since me" is byte-for-byte the
   * newest entry's own update, so the same diff appeared twice under two
   * different labels. One control here spans every range and says nothing twice.
   */
  const canPickRange = !!olderVersions && olderVersions.length > 1;
  const against =
    olderVersions?.find((v) => v.versionId === againstId) ?? previous;
  const comparingToPrevious = against?.versionId === previous?.versionId;
  const rangeLabels = useMemo(
    () =>
      Object.fromEntries(
        (olderVersions ?? []).map((v) => [v.versionId, rangeLabel(v)]),
      ),
    [olderVersions],
  );

  // Always OLDER → NEWER. Getting this backwards renders a change with additions
  // and deletions swapped, which reads as a plausible but completely wrong
  // history — the reason the pair is derived in one place.
  const pair = against ? { from: against, to: version } : undefined;

  return (
    <li className="relative pl-6">
      <Marker isAnchor={isAnchor} />

      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-1">
          <VersionLabel version={version} isAnchor={isAnchor} />
          <time
            dateTime={new Date(version.changedAt).toISOString()}
            title={formatDate(version.changedAt)}
            className="text-sm text-muted-foreground"
          >
            {timeAgo(version.changedAt)}
          </time>
          {version.descriptionChanged && (
            <Badge variant="warning">Description changed</Badge>
          )}
        </div>

        {isAnchor ? (
          <p className="pb-8 text-sm text-muted-foreground">
            Earliest recorded version.
          </p>
        ) : (
          <div className="pb-3">
            <Button
              variant="outline"
              size="xs"
              aria-expanded={open}
              // `leadingIcon`, not a child: the Button places children in the
              // label flow, so an icon passed as one wraps onto its own line
              // instead of sitting inside the control. The prop also drives the
              // iconLeft compound variant that corrects the optical padding.
              leadingIcon={
                <HugeiconsIcon
                  icon={ArrowDown01Icon}
                  size={14}
                  className={cn(
                    "transition-transform duration-100 ease-out",
                    open && "rotate-180",
                  )}
                />
              }
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "Hide changes" : "View changes"}
            </Button>
          </div>
        )}

        <CollapsibleContent>
          {open && pair && (
            <div className="pb-8">
              {canPickRange && (
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Compared against
                  </span>
                  <Select
                    value={against?.versionId}
                    // Base UI resolves the trigger's display text from this map;
                    // without it `SelectValue` falls back to printing the raw
                    // value, which here is a Convex document id.
                    items={rangeLabels}
                    onValueChange={(v) => {
                      if (typeof v === "string") setAgainstId(v);
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      variant="default"
                      aria-label="Compare current version against"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {olderVersions.map((v) => (
                        <SelectItem key={v.versionId} value={v.versionId}>
                          {rangeLabel(v)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Only when the diff spans exactly this row's own update. Across
                  a wider range, this row's stored before/after describes just
                  the most recent step and would misrepresent the span. */}
              {comparingToPrevious && <DescriptionChange version={version} />}

              <VersionDiff from={pair.from} to={pair.to} />
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

/** Label for a lookback option: when it was, plus its version where declared. */
function rangeLabel(v: VersionEntry) {
  return v.frontmatterVersion
    ? `${timeAgo(v.changedAt)} · ${v.frontmatterVersion}`
    : timeAgo(v.changedAt);
}

function Marker({ isAnchor }: { isAnchor: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute top-1.75 left-0 size-1.75 rounded-full",
        // Hollow for the anchor, filled for a real change: the shape carries the
        // distinction so it survives greyscale and the spine still reads as
        // terminating in something rather than stopping mid-air.
        isAnchor
          ? "border border-muted-foreground bg-background"
          : "bg-foreground",
      )}
    />
  );
}

/**
 * The row's headline.
 *
 * A version number is only shown when it actually MOVED. Printing the current
 * one on every row made consecutive content-only edits render as "1.4.0" twice
 * in a row, which reads as a duplicate entry rather than as two separate changes
 * that happened to ship under one version. Most upstream edits never touch the
 * version, so the unchanged case is the common one and has to read correctly.
 */
function VersionLabel({
  version,
  isAnchor,
}: {
  version: VersionEntry;
  isAnchor: boolean;
}) {
  const { frontmatterVersion, previousFrontmatterVersion } = version;
  const bumped =
    !!frontmatterVersion &&
    !!previousFrontmatterVersion &&
    previousFrontmatterVersion !== frontmatterVersion;

  if (bumped) {
    return (
      <span className="font-mono text-sm font-medium">
        <span className="text-muted-foreground">
          {previousFrontmatterVersion}
        </span>
        <span className="mx-1.5 text-muted-foreground">→</span>
        {frontmatterVersion}
      </span>
    );
  }

  return (
    <span className="text-sm font-medium">
      {isAnchor ? "First recorded" : "Updated"}
      {frontmatterVersion && (
        <span className="ml-2 font-mono font-normal text-muted-foreground">
          {frontmatterVersion}
        </span>
      )}
    </span>
  );
}

/**
 * Rendered above the file diff, not inside it, because the description is the
 * high-consequence change: it decides WHEN an agent reaches for a skill, so an
 * upstream edit changes an agent's behaviour without touching anyone's code.
 * Buried in a unified diff among body edits it would read as one more line.
 *
 * Both sides are stored inline on the version row, so this costs no fetch.
 */
function DescriptionChange({ version }: { version: VersionEntry }) {
  if (!version.descriptionChanged) return null;

  return (
    <dl className="mb-5 space-y-3 rounded-xl border border-border p-4">
      <div>
        <dt className="mb-1 font-mono text-eyebrow font-medium uppercase tracking-eyebrow text-muted-foreground">
          Description before
        </dt>
        <dd className="text-sm text-pretty text-muted-foreground">
          {version.descriptionBefore || <em>None</em>}
        </dd>
      </div>
      <div>
        <dt className="mb-1 font-mono text-eyebrow font-medium uppercase tracking-eyebrow text-muted-foreground">
          Description after
        </dt>
        <dd className="text-sm text-pretty">
          {version.descriptionAfter || <em>None</em>}
        </dd>
      </div>
    </dl>
  );
}
