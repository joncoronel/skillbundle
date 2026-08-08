"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { useTheme } from "next-themes";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { parseDiffFromFile } from "@pierre/diffs";
import { CodeView } from "@pierre/diffs/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";

import { api } from "@/convex/_generated/api";
import { LabeledSection } from "@/components/labeled-section";
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
import { solidSurface } from "@/lib/cubby-ui/elevated";
import { cn, formatDate, timeAgo } from "@/lib/utils";

type VersionEntry =
  (typeof api.skillVersions.listForSkill)["_returnType"][number];

/**
 * Shiki themes match the app's own code blocks (see
 * code-block/lib/shiki-shared), so a diff and a fenced block on the same page
 * are the same material rather than two vendors' idea of syntax colour.
 *
 * `diffIndicators: "classic"` is an accessibility requirement, not a taste call:
 * it puts +/- marks in the gutter so additions and removals are distinguishable
 * without relying on the red/green wash. PRODUCT.md commits to colour never
 * being the sole indicator of state, and a diff is the easiest place to break
 * that promise.
 */
const DIFF_OPTIONS = {
  theme: { light: "github-light", dark: "github-dark" },
  diffStyle: "unified",
  diffIndicators: "classic",
  /**
   * Wrap long lines rather than scrolling them horizontally.
   *
   * This is forced, not preferred. CodeView's horizontal scroller is a `<code>`
   * element inside its shadow root, while the vertical scroll has to live on a
   * container out here (the library gives no way to cap its height internally).
   * Two scrollers on two layers means the horizontal bar sits inside the
   * vertically-scrolled content and slides out of sight the moment you scroll
   * up. Measured, not assumed: with `overflow: "scroll"` the light-DOM container
   * reports y-scroll only and the shadow `<code>` reports x-scroll only, and no
   * placement of the height cap merges them — including putting
   * `max-h-96 overflow-auto` directly on CodeView, which was tried.
   *
   * Wrapping deletes the horizontal axis, so one scroller remains.
   *
   * The cost is real and worth naming: a wrapped line occupies several rows
   * under one line number, and fenced code or shell commands inside a SKILL.md
   * lose their alignment. It lands acceptably here only because a SKILL.md is
   * prose-dominant — its longest lines are description sentences, where wrapping
   * beats clipping "…for risky package" mid-thought. If this ever hosts
   * code-dominant files, revisit it as a user-facing wrap toggle rather than
   * flipping the default back.
   */
  overflow: "wrap",
  disableFileHeader: true,
  lineDiffType: "word",
  /**
   * Repaint the code surface in the app's own palette.
   *
   * The Shiki theme ships its own page background — github-dark's blue-grey
   * `#24292e` — which sat inside the violet-tinted muted tray as a foreign slab.
   * The app's code block DOES have two layers, but both are its own neutrals: a
   * `bg-muted` tray around a `--surface-3` panel. So the fix is to adopt
   * `--surface-3`, not to go transparent — transparent would collapse a
   * distinction the app's own code blocks deliberately make. Using the token
   * also means light mode follows for free.
   *
   * It has to go through `unsafeCSS`. The theme writes `--diffs-dark-bg` /
   * `--diffs-light-bg` onto `:host` from inside the shadow root, and a `:host`
   * rule beats a custom property inherited from outside — so setting them on the
   * wrapper does nothing, and neither does the `disableBackground` option. The
   * component declares `@layer base, theme, rendered, unsafe`, and `unsafeCSS`
   * lands in that last layer, the only thing that outranks the theme's output.
   *
   * Added and removed line tints are separate variables and survive untouched.
   */
  unsafeCSS: [
    ":host {",
    "  --diffs-dark-bg: var(--surface-3);",
    "  --diffs-light-bg: var(--surface-3);",
    // The collapsed-context bar. `--surface-4` was wrong: light mode collapses
    // surfaces 3 through 8 to pure white, so the bar vanished against the panel.
    // `--muted` is the same token the code block's tray uses and is darker than
    // the surface-3 panel in BOTH themes (0.94 vs white in light, 0.24 vs 0.264
    // in dark), so the bar stays legible either way.
    "  --diffs-bg-separator: var(--muted);",
    "}",
  ].join("\n"),
} as const;

/**
 * Typography for the diff's shadow DOM.
 *
 * The renderer draws into a shadow root, so app CSS cannot reach it — but custom
 * properties DO inherit across the boundary, and the library reads these. Type
 * values are lifted verbatim from the app's code block (`font-mono
 * text-[.8125rem] leading-normal`).
 *
 * Only typography lives here. The surface colours have to go through
 * `unsafeCSS` in DIFF_OPTIONS instead — see the note there on why `--diffs-bg`
 * and `disableBackground` are both dead ends.
 */
const DIFF_SURFACE_VARS = {
  "--diffs-font-family": "var(--font-geist-mono)",
  "--diffs-font-size": "0.8125rem",
  "--diffs-line-height": "1.5",
} as CSSProperties;

/**
 * Resolve the diff's light/dark against the APP's theme rather than the OS.
 *
 * The library's default (`themeType: "system"`) reads `prefers-color-scheme`,
 * but this app drives its own theme through next-themes and ships a manual
 * switcher. Left on the default, someone who sets the app to light while their
 * OS is dark gets a dark diff embedded in a light page.
 *
 * Falls back to "system" until next-themes has mounted, which is its documented
 * hydration behaviour — `resolvedTheme` is undefined on the first client render.
 */
function useDiffOptions() {
  const { resolvedTheme } = useTheme();
  return useMemo(
    () => ({
      ...DIFF_OPTIONS,
      themeType:
        resolvedTheme === "dark"
          ? ("dark" as const)
          : resolvedTheme === "light"
            ? ("light" as const)
            : ("system" as const),
    }),
    [resolvedTheme],
  );
}

export function SkillHistory({
  source,
  skillId,
  className,
}: {
  source: string;
  skillId: string;
  className?: string;
}) {
  const { data: versions, isPending } = useQuery(
    convexQuery(api.skillVersions.listForSkill, { source, skillId }),
  );

  return (
    <LabeledSection label="History" className={className} id="history">
      {isPending ? (
        <div className="flex items-center gap-3 py-2 text-sm text-muted-foreground">
          <DotMatrixRipple className="size-4" />
          Loading history
        </div>
      ) : !versions || versions.length === 0 ? (
        <EmptyHistory />
      ) : (
        <ol className="relative">
          {/* The spine. Inset to run through the centre of the 7px markers, and
              stopped short of the last row so the timeline reads as ending at
              the earliest entry rather than trailing into nothing. */}
          <span
            aria-hidden
            className="absolute top-2 bottom-8 left-0.75 w-px bg-border"
          />
          {versions.map((version, i) => (
            <HistoryRow
              key={version.versionId}
              version={version}
              // The row below is chronologically previous, since the query
              // returns newest first.
              previous={versions[i + 1]}
              // Only the newest row offers a lookback range; see HistoryRow.
              olderVersions={i === 0 ? versions.slice(1) : undefined}
            />
          ))}
        </ol>
      )}
    </LabeledSection>
  );
}

function EmptyHistory() {
  return (
    <p className="max-w-prose text-sm text-pretty text-muted-foreground">
      No changes recorded yet. SkillBundle began tracking edits to skill files in
      August 2026, so a skill that hasn&apos;t changed since then has nothing
      here.
    </p>
  );
}

function HistoryRow({
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

/**
 * Fetches both versions' raw SKILL.md straight from storage and hands the two
 * strings to the renderer, which computes the diff client-side.
 *
 * Nothing routes content through a Convex function: queries return storage URLs
 * only, so a 15 KB file never crosses a serverless boundary and repeat views hit
 * the same cacheable URL.
 *
 * `from` is always the OLDER side. See the `pair` comment in HistoryRow.
 */
function VersionDiff({ from, to }: { from: VersionEntry; to: VersionEntry }) {
  // Before the early returns below — hooks cannot be conditional.
  const diffOptions = useDiffOptions();
  const { data, isPending, isError } = useQuery({
    queryKey: ["skillVersionDiff", from.versionId, to.versionId],
    queryFn: async () => {
      if (!from.contentUrl || !to.contentUrl) {
        throw new Error("Version content is unavailable");
      }
      const [before, after] = await Promise.all([
        fetch(from.contentUrl).then((r) => r.text()),
        fetch(to.contentUrl).then((r) => r.text()),
      ]);
      return { before, after };
    },
    // Version content is immutable once written, so it never needs revalidating
    // and re-expanding a row should be instant.
    staleTime: Infinity,
    gcTime: Infinity,
  });

  if (isPending) {
    return (
      <div className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
        <DotMatrixRipple className="size-4" />
        Loading diff
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        This version&apos;s file could not be loaded, so there is no diff to
        show. The change itself is still recorded above.
      </p>
    );
  }

  const fileDiff = parseDiffFromFile(
    { name: "SKILL.md", contents: data.before },
    { name: "SKILL.md", contents: data.after },
  );

  return (
    // ONE container, no tray. This matches how fenced code actually renders in
    // skill content: markdown-content.tsx passes the outer CodeBlock
    // `rounded-none bg-transparent p-0! shadow-none` and comments that it is
    // "always a structureless wrapper (no padding, fill, or ring), so the code
    // is a single container, never a box-in-a-box". The tray exists on the raw
    // CodeBlock component but the app's own prose never shows it, so a diff
    // rendering one was the odd surface out.
    //
    // The surface lives on the single panel below, as solidSurface(3) — the
    // elevated card with its rim and shadow, exactly what CodeBlockPre carries.
    <div className="w-full" style={DIFF_SURFACE_VARS}>
      {/* CodeView rather than MultiFileDiff, on the library's own advice: the
          lower-level components hand virtualization to the caller and blank when
          nothing supplies a render window, which is exactly what they did here —
          container mounted, stylesheet attached, <pre> with zero rows and no
          console error. CodeView owns its rendering surface. */}
      {/* The single surface, mirroring CodeBlockPre: `rounded-lg`, capped at
          `max-h-96`, carrying solidSurface(3)'s elevated fill, rim and shadow.

          The height cap and the scroll must be on the SAME element. Putting
          `max-h-96` on CodeView's own className capped a div whose `overflow` is
          `visible`, so expanding a collapsed hunk pushed content past the cap
          and an outer `overflow-hidden` simply clipped it — the extra lines
          rendered but were unreachable, with nothing to scroll. */}
      <div
        className={cn("max-h-96 overflow-y-auto rounded-lg", solidSurface(3))}
      >
        <CodeView
          // Keyed by the version pair so changing the comparison range is a new
          // item rather than a mutated one.
          items={[
            { id: `${from.versionId}:${to.versionId}`, type: "diff", fileDiff },
          ]}
          options={diffOptions}
          disableWorkerPool
        />
      </div>
    </div>
  );
}
