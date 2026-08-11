"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import {
  versionDiffQueryOptions,
  type DiffPair,
  type VersionEntry,
} from "./skill-history-diff-query";

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
import { cn, formatDate } from "@/lib/utils";

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
  return (diffModulePromise ??= import("./skill-history-diff")
    .then((m) => {
      diffModule = m;
      return m;
    })
    // Clear the memo on failure, or the FIRST rejection is cached for the life
    // of the page: `??=` stores the promise, not the module, so every later
    // call re-rejects with the original error and the panel's "Try again"
    // button can never succeed. Bundlers evict a failed chunk and will retry
    // the import, so dropping the memo is all that's needed to let them.
    .catch((error: unknown) => {
      diffModulePromise = null;
      throw error;
    }));
}

// Re-exported from the query module, which owns it now: the type and the cache
// key derived from it belong together.
export type { VersionEntry };

/**
 * How long a busy state stays up once it appears.
 *
 * The row fetches on click rather than on hover, so a warm cache or a fast
 * connection can resolve in well under a tenth of a second — fast enough that
 * the indicator appears and vanishes as a flicker, which reads as a glitch
 * rather than as progress. Holding it for a beat makes the wait legible: the
 * reader sees that the click registered and that something is loading.
 *
 * The floor applies ONLY when there is something to wait for. Content is
 * cached for 30 minutes with `staleTime: Infinity`, so re-opening a row it has
 * already fetched resolves in about a millisecond — padding that out is not a
 * loading state, it is a delay reporting work nobody is doing. See `isReady`.
 *
 * An earlier design chased the same goal from the other side, prefetching on
 * hover so the indicator would rarely be needed at all. That removed the
 * flicker but paid for it with a background fetch per row a reader merely
 * passed over.
 *
 * Worth naming explicitly, because the codebase holds the opposite rule
 * elsewhere: `deriveInputLoading` in hooks/use-debounced-query-value.ts spells
 * out a derived-loading-state rule with no timers, and search inputs follow it.
 * The two coexist deliberately. That rule is about never spinning over results
 * the reader already has, which `isReady` enforces here too — this floor only
 * ever applies to a fetch that genuinely happened, and never delays the ready
 * path. If it ever gates a path with nothing to wait for, it has become the
 * thing that rule forbids.
 */
const MIN_BUSY_MS = 250;

/** Resolves once `ms` has elapsed since `startedAt`, immediately if it already has. */
function holdFor(startedAt: number, ms: number) {
  const remaining = ms - (Date.now() - startedAt);
  return remaining > 0
    ? new Promise((resolve) => setTimeout(resolve, remaining))
    : Promise.resolve();
}

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
  // Links the trigger to the panel it discloses. `aria-controls` is optional in
  // the APG disclosure pattern, but this row bypasses `CollapsibleTrigger` (it
  // needs a Button with its own busy state), which is what would otherwise wire
  // it — and the install disclosure in bundle-view.tsx already does this, so
  // the two would disagree within one change.
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [Diff, setDiff] = useState<DiffModule["VersionDiff"] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [againstId, setAgainstId] = useState<string | undefined>(
    previous?.versionId,
  );
  const queryClient = useQueryClient();
  // Guards against out-of-order range swaps: a slow first fetch must not land
  // after a later one and drag the selection backwards.
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
   * True when this row needs to fetch nothing, checked synchronously so it can
   * gate the busy state rather than trail it.
   *
   * Independent of how the content got there. Nothing prefetches any more, so
   * in practice this is true when re-opening a row, or opening one whose exact
   * comparison was viewed earlier — cases where showing a timed indicator would
   * be reporting work that is not happening.
   */
  function isReady(target: DiffPair) {
    if (!diffModule) return false;
    const { queryKey } = versionDiffQueryOptions(target);
    return queryClient.getQueryData(queryKey) !== undefined;
  }

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
   * animates straight to the content's real height — one motion, no jump.
   *
   * The work starts on the click, not before it. Nothing is warmed on hover or
   * focus. When there IS work, `MIN_BUSY_MS` keeps the indicator on screen long
   * enough to read; when there is not, the row opens on this render.
   *
   * Failures deliberately fall through to opening anyway — VersionDiff renders
   * its own error state, which is a better place to explain the problem than a
   * button that silently refuses to expand.
   */
  async function openWithDiff() {
    if (!pair) return;
    setLoadFailed(false);

    // Already in hand: open on this render, with no indicator at all.
    // Captured into a const because `diffModule` is a mutable module-scope
    // binding, so TypeScript cannot keep the narrowing inside the closure.
    const loaded = diffModule;
    if (loaded && isReady(pair)) {
      setDiff(() => loaded.VersionDiff);
      setOpen(true);
      return;
    }

    setOpening(true);
    const startedAt = Date.now();

    try {
      const [mod] = await Promise.all([
        loadDiffModule(),
        queryClient.prefetchQuery(versionDiffQueryOptions(pair)),
      ]);
      setDiff(() => mod.VersionDiff);
    } catch {
      // The chunk itself failed (offline, a bad deploy). Content fetches are
      // VersionDiff's own problem and it reports them in place; this is the one
      // failure that would otherwise open an empty panel.
      setLoadFailed(true);
    } finally {
      await holdFor(startedAt, MIN_BUSY_MS);
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
   * a filter change. Fetching first and switching after keeps the current diff
   * on screen the whole time, so the height only moves once, to the new diff's
   * own size.
   *
   * The busy state carries the same `MIN_BUSY_MS` floor as opening, so a fast
   * fetch does not flash the indicator on and off — and the same readiness
   * check, so a comparison already viewed swaps instantly instead of waiting
   * out a floor for work that is not happening.
   */
  async function changeRange(next: string) {
    if (next === againstId) return;
    const target = olderVersions?.find((v) => v.versionId === next);
    if (!target) return;

    // The select stays enabled during a swap, so a reader can pick again before
    // the first fetch lands. Every swap takes a token and only the newest one
    // is allowed to apply its result — without that, a slow first pick resolves
    // after a later one and drags the selection back to a range the reader had
    // already moved off.
    const token = ++swapToken.current;

    // Same rule as opening: a comparison already fetched swaps on this render.
    if (isReady({ from: target, to: version })) {
      setSwapping(false);
      setAgainstId(next);
      return;
    }

    const startedAt = Date.now();
    setSwapping(true);
    try {
      await queryClient.prefetchQuery(
        versionDiffQueryOptions({ from: target, to: version }),
      );
    } catch {
      // Fall through and switch anyway — VersionDiff surfaces the failure with
      // more context than a select that silently ignores the click.
    } finally {
      // Hold FIRST, then check the token. Checking before the hold looks
      // equivalent and is not: `holdFor` is a real `setTimeout`, so the
      // function yields for up to MIN_BUSY_MS between the check and the
      // commit, and a swap that passed the check can be superseded inside that
      // window. Concretely — pick an uncached range whose fetch takes 100ms,
      // then pick an already-viewed one at 150ms: the second applies instantly
      // through the readiness path above, and at 250ms the first wakes up and
      // overwrites it. That is the exact failure this token exists to prevent,
      // reintroduced by the floor rather than by the original fast path.
      // Guarded with a positive condition rather than an early `return`. A
      // `return` inside `finally` overrides whatever the `try`/`catch` was
      // doing, so it is correct only as long as neither of them ever returns or
      // rethrows — a constraint that is invisible at the point someone would
      // break it.
      await holdFor(startedAt, MIN_BUSY_MS);
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
          {/* Absolute, via formatDate, and this is load-bearing rather than a
              style preference: `timeAgo` reads `Date.now()`, and these rows now
              render on the server (see the header of skill-history.tsx).

              Under Cache Components that read is unstable IO, so the whole
              SkillDetailBody subtree stops being prerenderable — and because the
              body already sits inside a `<Suspense>`, nothing errors. The hole
              is simply legal and permanent: Vercel persists only the static
              shell, and every cached hit serves the skeleton and re-renders the
              content on the client. Measured on preview deployments that
              differed by this call alone: the cached HTML went from 366 KB with
              the body to 231 KB without it.

              lib/utils.ts says the same thing from the other side — formatDate
              is deterministic "so it prerenders into the static shell".

              If relative times are ever wanted back here, they have to come from
              a client-side swap after hydration; they cannot be rendered on the
              server. */}
          <time
            dateTime={new Date(version.changedAt).toISOString()}
            className="text-sm text-muted-foreground"
          >
            {formatDate(version.changedAt)}
          </time>
          {version.descriptionChanged && (
            <Badge variant="warning">Description changed</Badge>
          )}
        </div>

        {isAnchor ? (
          // An anchor can still carry a REAL description change, and used to
          // say only "Earliest recorded version" while the row's own
          // "Description changed" badge sat directly above it — a flat
          // contradiction to anyone reading the two together.
          //
          // Both sides of the description live on the row itself rather than in
          // the predecessor blob, so the high-consequence half of the change is
          // available here even though the body diff never can be. Same
          // component the diff view uses, so the two paths present the change
          // identically.
          <div className="pb-8">
            <p className="text-sm text-muted-foreground">
              Earliest recorded version.
              {version.descriptionChanged
                ? " There is no earlier copy of the file to compare against, so only the description change is shown."
                : ""}
            </p>
            <DescriptionChange version={version} className="mt-3 mb-0" />
          </div>
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
              aria-controls={panelId}
              // `leadingIcon`, not a child: the Button places children in the
              // label flow, so an icon passed as one wraps onto its own line
              // instead of sitting inside the control. The prop also drives the
              // iconLeft compound variant that corrects the optical padding.
              // The Button owns the busy visual. Its `inline` loading layout
              // puts the DotMatrixRipple in the leading icon's own slot, so the
              // control keeps its exact geometry — hand-swapping the icon here
              // sized the ripple differently and nudged the trigger.
              loading={opening}
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

        {/* Widen the clip box without moving the content.
            CollapsibleContent needs `overflow-hidden` to animate its height, so
            anything painted outside a child's box — the diff surface's 1px rim,
            a control's 2px focus ring at `outline-offset-2` — gets shaved
            wherever that child sits flush with the panel edge.

            Padding the panel and pulling it back by the same amount moves the
            clip boundary outward while leaving layout identical: 4px on the
            sides (enough for the rim) and 8px on top (enough for a focus ring,
            which reaches 4px, plus margin).

            TOP is safe but BOTTOM is not, and that asymmetry is the point.
            Content is anchored at the panel's top, so a top margin only ever
            reveals the empty band above it — the rim and ring we want. A bottom
            margin would reveal real content below the panel while it collapses,
            since that is the edge the animation clips against.

            Safe at every breakpoint: 4px eats into padding that is fixed rather
            than proportional — the row's own `pl-6` (24px) on the left, the page
            container's `px-4` (16px) on the right. */}
        <CollapsibleContent
          id={panelId}
          className="px-1 -mx-1 pt-2 -mt-2 duration-0"
        >
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
                        >
                          {rangeLabel(v)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* A real text live region, because the visual one below
                      cannot announce.

                      Hold-then-swap means the trigger keeps reading the OLD
                      version for the whole fetch: the popup closes, focus
                      returns to the trigger, and nothing about the control says
                      work is in flight. Toggling `aria-hidden` on the span
                      below does not fix that — a live region announces on
                      *content* change, not on visibility. Without this, a
                      non-visual user picks a range, hears the previous value
                      read back, and the diff changes unannounced some hundreds
                      of milliseconds later. */}
                  <span role="status" aria-live="polite" className="sr-only">
                    {swapping ? "Loading comparison" : ""}
                  </span>
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
                      <DotMatrixRipple
                        size="xs"
                        ariaLabel="Loading comparison"
                      />
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
  // formatDate, not timeAgo, for the same prerender reason as the row's <time>
  // above: these labels are built during render, and the select's trigger shows
  // the current one in the server HTML.
  return v.frontmatterVersion
    ? `${formatDate(v.changedAt)} · ${v.frontmatterVersion}`
    : formatDate(v.changedAt);
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
function DescriptionChange({
  version,
  className,
}: {
  version: VersionEntry;
  className?: string;
}) {
  if (!version.descriptionChanged) return null;

  return (
    <dl
      className={cn(
        "mb-5 space-y-3 rounded-xl border border-border p-4",
        className,
      )}
    >
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
