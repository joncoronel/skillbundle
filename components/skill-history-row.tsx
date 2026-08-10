"use client";

import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { versionDiffQueryOptions } from "./skill-history-diff-query";

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
 * The renderer is still code-split — it pulls the full shiki bundle plus a
 * second @shikijs/core (see the header of skill-history-diff.tsx), and only
 * matters once someone expands a row.
 *
 * Deliberately NOT `next/dynamic`. Its `loading` fallback renders for at least
 * one frame on first mount even when the module is already in the registry, so
 * preloading could never remove the "Loading diff" flash — the row opened, then
 * the diff appeared underneath it a beat later. Holding the resolved module in
 * state instead means the component is in hand *before* anything opens, and the
 * panel animates once, straight to its real height.
 *
 * The promise is module-scope so the second row a reader opens pays nothing.
 */
type DiffModule = typeof import("./skill-history-diff");
let diffModulePromise: Promise<DiffModule> | null = null;
/**
 * Set synchronously once the chunk lands, so a render can ask "is this already
 * here?" without awaiting. That check is what keeps the busy state honest — see
 * `openWithDiff`.
 */
let diffModule: DiffModule | null = null;
function loadDiffModule(): Promise<DiffModule> {
  if (diffModule) return Promise.resolve(diffModule);
  return (diffModulePromise ??= import("./skill-history-diff").then((m) => {
    diffModule = m;
    return m;
  }));
}

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
  const [opening, setOpening] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [Diff, setDiff] = useState<DiffModule["VersionDiff"] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [againstId, setAgainstId] = useState<string | undefined>(
    previous?.versionId,
  );
  const queryClient = useQueryClient();
  // Guards against out-of-order range swaps: a slow first prefetch must not
  // land after a later one and drag the selection backwards.
  const swapToken = useRef(0);

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

  /**
   * Load first, then reveal.
   *
   * Expanding immediately meant the panel animated open to a near-empty box and
   * then jumped, because three things still had to happen behind it: the
   * renderer chunk (~420 KB, deliberately code-split) had to download, both
   * version blobs had to be fetched from Convex storage, and only then could the
   * diff parse and highlight. The open animation finished long before any of
   * that, so the content arrived as a second, unannounced layout change.
   *
   * Doing the work up front and opening once it lands means the collapsible
   * animates straight to the content's real height — one motion, no jump. The
   * cost is that the click is not instant, which is why the trigger takes a
   * pending label rather than staying silent.
   *
   * Both halves are warmed together: the dynamic import populates the module
   * registry so `VersionDiff` mounts synchronously, and the prefetch uses the
   * same query key the component reads, so its `useQuery` is already resolved.
   *
   * Failures deliberately fall through to opening anyway — VersionDiff renders
   * its own error state, which is a better place to explain the problem than a
   * button that silently refuses to expand.
   */
  /**
   * True when everything this row needs is already in hand, checked
   * synchronously so it can gate the busy state rather than trail it.
   *
   * Re-opening a row, or opening a second row after the chunk has landed, is
   * genuinely instant — showing a ripple for it produces a flash that reports
   * work nobody waited for. Deliberately NOT solved with an appearance delay or
   * a minimum-visible floor: those add latency to the fast path and mask a
   * dishonest signal instead of fixing it. Same approach as `isInputLoading` in
   * hooks/use-debounced-cached-search.ts.
   */
  function alreadyLoaded(target: { from: VersionEntry; to: VersionEntry }) {
    if (!diffModule) return false;
    const { queryKey } = versionDiffQueryOptions(target.from, target.to);
    return queryClient.getQueryData(queryKey) !== undefined;
  }

  /**
   * Warm the renderer and a pair's content ahead of the click.
   *
   * This is the actual fix for the brief indicator, rather than padding it with
   * a timer. Pointing at a control is a reliable signal of intent and buys a few
   * hundred milliseconds of head start, which is enough for the two content
   * fetches — so by the time the click lands `alreadyLoaded` is true and the row
   * opens on that render with no busy state at all.
   *
   * Fire-and-forget on purpose: no state is set here, so hovering never causes a
   * render. Both calls are idempotent — the module promise is memoised, and
   * `prefetchQuery` is a no-op against data that is already fresh (these entries
   * never go stale) or already in flight.
   *
   * The chunk is ~420 KB, so this does download it for someone who hovers and
   * never clicks. That is the same trade any hover-prefetch makes, bounded here
   * by the module being fetched once per session rather than per row.
   */
  function warm(target: { from: VersionEntry; to: VersionEntry } | undefined) {
    if (!target) return;
    void loadDiffModule();
    void queryClient.prefetchQuery(
      versionDiffQueryOptions(target.from, target.to),
    );
  }

  async function openWithDiff() {
    if (!pair) return;
    setLoadFailed(false);

    // Nothing to wait for: open on this render, no busy state at all.
    if (alreadyLoaded(pair) && diffModule) {
      setDiff(() => diffModule!.VersionDiff);
      setOpen(true);
      return;
    }

    setOpening(true);
    try {
      const [mod] = await Promise.all([
        loadDiffModule(),
        queryClient.prefetchQuery(versionDiffQueryOptions(pair.from, pair.to)),
      ]);
      setDiff(() => mod.VersionDiff);
    } catch {
      // The chunk itself failed (offline, a bad deploy). Content fetches are
      // VersionDiff's own problem and it reports them in place; this is the one
      // failure that would otherwise open an empty panel.
      setLoadFailed(true);
    } finally {
      setOpening(false);
      setOpen(true);
    }
  }

  /**
   * Swap the comparison range without collapsing the panel.
   *
   * Changing `againstId` immediately swapped in a pair whose content was not
   * cached, so the diff dropped to a short pending state and the panel
   * collapsed to it before growing back — a full-height jump for what reads as
   * a filter change. Prefetching first and switching after keeps the current
   * diff on screen the whole time, so the height only moves once, to the new
   * diff's own size.
   */
  async function changeRange(next: string) {
    if (next === againstId) return;
    const target = olderVersions?.find((v) => v.versionId === next);
    if (!target) return;

    // Same honesty rule as opening: a range already fetched swaps on this
    // render, with no indicator for work that isn't happening.
    if (alreadyLoaded({ from: target, to: version })) {
      setAgainstId(next);
      return;
    }

    const token = ++swapToken.current;
    setSwapping(true);
    try {
      await queryClient.prefetchQuery(
        versionDiffQueryOptions(target, version),
      );
    } catch {
      // Fall through and switch anyway — VersionDiff surfaces the failure with
      // more context than a select that silently ignores the click.
    } finally {
      if (token === swapToken.current) {
        setSwapping(false);
        setAgainstId(next);
      }
    }
  }

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
          // `flex`, not a bare block. The Button is `inline-flex`, so in an
          // inline formatting context it sits on a text baseline — and an
          // inline-flex box takes its baseline from its first flex item. When
          // the busy state swaps that item from the chevron SVG to the loader,
          // the button's baseline moves, the line box grows to absorb it, and
          // the trigger visibly drops. Measured: this wrapper went 40px to 49px
          // and back while the button itself held 28px throughout. Making the
          // wrapper a flex container removes the line box, so only the button's
          // own height can affect it.
          <div className="flex pb-3">
            <Button
              variant="outline"
              size="xs"
              aria-expanded={open}
              // `leadingIcon`, not a child: the Button places children in the
              // label flow, so an icon passed as one wraps onto its own line
              // instead of sitting inside the control. The prop also drives the
              // iconLeft compound variant that corrects the optical padding.
              // The Button owns the busy visual. Its `inline` loading layout
              // puts the DotMatrixRipple in the leading icon's own slot, so the
              // control keeps its exact geometry — hand-swapping the icon here
              // sized the ripple differently and nudged the trigger.
              loading={opening}
              // Head start on intent, across every input type:
              //   onPointerEnter — mouse approach, hundreds of ms of warning.
              //   onPointerDown  — the press itself. Fires on finger-down while
              //                    `click` waits for release, so touch gets a
              //                    head start too. There is no hover on touch,
              //                    so without this the tap would always pay the
              //                    full fetch.
              //   onFocus        — keyboard, which fires neither of the above.
              // All three are idempotent, so overlapping them costs nothing.
              onPointerEnter={() => warm(pair)}
              onPointerDown={() => warm(pair)}
              onFocus={() => warm(pair)}
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
              onClick={() => {
                if (open) {
                  setOpen(false);
                } else {
                  void openWithDiff();
                }
              }}
            >
              {/* Label held steady through the busy state. Swapping it to
                  "Loading changes" changed the button's width mid-interaction,
                  which reflowed the row. The ripple already says it. */}
              {open ? "Hide changes" : "View changes"}
            </Button>
          </div>
        )}

        <CollapsibleContent>
          {/* No `open &&` guard here, deliberately. CollapsibleContent animates
              its exit with `data-[ending-style]:h-0`, which needs Base UI to
              keep the panel mounted while that transition runs. Gating the
              children on `open` tore them out the moment it flipped, so the
              panel had nothing left to collapse from and only the opening
              animation ever played. Base UI's Panel already unmounts its
              children when closed — after the animation — so the guard was
              redundant as well as harmful. */}
          {pair && (
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
                      if (typeof v === "string") void changeRange(v);
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      variant="default"
                      aria-label="Compare current version against"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    {/* Matches the catalog filter selects: the popup opens over
                        the trigger with the current option aligned to it, rather
                        than dropping below. Elevation stays at the component
                        default — catalog-controls raises its popups to level 5
                        because they sit on a raised toolbar, whereas this one is
                        on the page background. */}
                    <SelectContent alignItemWithTrigger>
                      {olderVersions.map((v) => (
                        <SelectItem
                          key={v.versionId}
                          value={v.versionId}
                          // Same reason as the trigger, same three inputs.
                          onPointerEnter={() => warm({ from: v, to: version })}
                          onPointerDown={() => warm({ from: v, to: version })}
                          onFocus={() => warm({ from: v, to: version })}
                        >
                          {rangeLabel(v)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* Occupies its slot in both states so the row cannot reflow
                      when the swap starts. The diff below stays on screen while
                      this runs — the indicator is the only thing that changes. */}
                  <span
                    aria-hidden={!swapping}
                    className={cn(
                      "grid size-4 shrink-0 place-items-center transition-opacity duration-100 ease-out",
                      swapping ? "opacity-100" : "opacity-0",
                    )}
                  >
                    {swapping ? (
                      <DotMatrixRipple size="xs" ariaLabel="Loading comparison" />
                    ) : null}
                  </span>
                </div>
              )}

              {/* Only when the diff spans exactly this row's own update. Across
                  a wider range, this row's stored before/after describes just
                  the most recent step and would misrepresent the span. */}
              {comparingToPrevious && <DescriptionChange version={version} />}

              {Diff ? (
                <Diff from={pair.from} to={pair.to} />
              ) : loadFailed ? (
                <DiffUnavailable onRetry={() => void openWithDiff()} />
              ) : null}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

/**
 * Shown only when the renderer chunk itself failed to load — offline, or a
 * deploy that moved the file. Names the problem and the recovery rather than
 * leaving an opened panel empty.
 */
function DiffUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center">
      <p className="text-sm text-muted-foreground">
        Couldn&apos;t load the diff viewer.
      </p>
      <Button variant="outline" size="xs" className="mt-3" onClick={onRetry}>
        Try again
      </Button>
    </div>
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
