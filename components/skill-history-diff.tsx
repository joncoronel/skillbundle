"use client";

/**
 * The diff viewer, split out of skill-history.tsx so it can be loaded on demand.
 *
 * `@pierre/diffs` statically pulls the FULL bundled `shiki` entry (the app's own
 * code blocks deliberately use `shiki/core` plus explicit dynamic theme
 * imports), and `@shikijs/transformers` drags in a second `@shikijs/core`
 * alongside the app's. A static import in a client module puts all of that in
 * the route's initial chunk for every visitor — and the History section is
 * collapsed by default, so the render was gated while the download was not.
 * Skill detail is the main landing surface from search and shared links, so
 * this sat on its LCP path.
 *
 * skill-detail-sheet.tsx makes the same call for the same reason.
 */

import { useMemo, type CSSProperties } from "react";
import { useTheme } from "next-themes";
import { useQuery } from "@tanstack/react-query";
import { parseDiffFromFile } from "@pierre/diffs";
import { CodeView } from "@pierre/diffs/react";
import { versionDiffQueryOptions } from "./skill-history-diff-query";

import type { api } from "@/convex/_generated/api";
import { DotMatrixRipple } from "@/components/ui/dot-matrix-ripple";
import { elevatedSurface } from "@/lib/cubby-ui/elevated";
import { cn } from "@/lib/utils";

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
export function VersionDiff({ from, to }: { from: VersionEntry; to: VersionEntry }) {
  // Before the early returns below — hooks cannot be conditional.
  const diffOptions = useDiffOptions();
  // Options live in skill-history-diff-query.ts so the row can prefetch with
  // the identical key before it opens — by the time this mounts the content is
  // usually already in the cache, so it renders at final height rather than
  // growing into it. See the comment on the trigger in skill-history-row.tsx.
  const { data, isPending, isError } = useQuery(
    versionDiffQueryOptions(from, to),
  );

  // Memoised, and above the early returns. `data` is frozen (staleTime and
  // gcTime are both Infinity), so the diff is a pure function of two immutable
  // strings — but computed in the render body it re-ran on every parent render:
  // opening or closing a row, changing the comparison range, any re-emit of the
  // history subscription, and every theme flip. Each run is a word-level diff
  // over two SKILL.md files, tens of KB, synchronously on the main thread — and
  // because both this and the `items` array below were new identities each
  // time, CodeView re-entered its highlight pipeline too, also on the main
  // thread (`disableWorkerPool`).
  const fileDiff = useMemo(
    () =>
      data
        ? parseDiffFromFile(
            { name: "SKILL.md", contents: data.before },
            { name: "SKILL.md", contents: data.after },
          )
        : null,
    [data],
  );
  const items = useMemo(
    () =>
      fileDiff
        ? [
            {
              id: `${from.versionId}:${to.versionId}`,
              type: "diff" as const,
              fileDiff,
            },
          ]
        : [],
    [fileDiff, from.versionId, to.versionId],
  );

  if (isPending) {
    return (
      <div className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
        <DotMatrixRipple className="size-4" />
        Loading diff
      </div>
    );
  }

  if (isError || !data || !fileDiff) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        This version&apos;s file could not be loaded, so there is no diff to
        show. The change itself is still recorded above.
      </p>
    );
  }

  return (
    // ONE container, no tray. This matches how fenced code actually renders in
    // skill content: markdown-content.tsx passes the outer CodeBlock
    // `rounded-none bg-transparent p-0! shadow-none` and comments that it is
    // "always a structureless wrapper (no padding, fill, or ring), so the code
    // is a single container, never a box-in-a-box". The tray exists on the raw
    // CodeBlock component but the app's own prose never shows it, so a diff
    // rendering one was the odd surface out.
    //
    // The surface lives on the single panel below, as elevatedSurface(3) — the
    // elevated card with its rim and shadow, exactly what CodeBlockPre carries.
    <div className="w-full" style={DIFF_SURFACE_VARS}>
      {/* CodeView rather than MultiFileDiff, on the library's own advice: the
          lower-level components hand virtualization to the caller and blank when
          nothing supplies a render window, which is exactly what they did here —
          container mounted, stylesheet attached, <pre> with zero rows and no
          console error. CodeView owns its rendering surface. */}
      {/* The single surface, mirroring CodeBlockPre: `rounded-lg`, capped at
          `max-h-96`, carrying elevatedSurface(3)'s fill, rim and shadow.

          The height cap and the scroll must be on the SAME element. Putting
          `max-h-96` on CodeView's own className capped a div whose `overflow` is
          `visible`, so expanding a collapsed hunk pushed content past the cap
          and an outer `overflow-hidden` simply clipped it — the extra lines
          rendered but were unreachable, with nothing to scroll. */}
      {/* Two elements, and the split is load-bearing.

          The rim only exists in dark mode (`--surface-rim-3` is
          `0 0 transparent` in light), which is why this only ever showed up
          there. Two separate things were eating it.

          First, it is an INSET shadow, and Chromium paints those against an
          element's scrollable overflow area rather than its visible box — so
          while the surface and the scroller were one element, the rim scrolled
          away with the content.

          Second, an inset shadow paints BEHIND its children, and the diff's
          rows carry opaque tints right up to the container's edges, so they
          covered it. `elevatedSurface` is the house answer: same fill and drop
          shadow, but the rim moves to an `::after` overlay that re-paints above
          the children. `solidSurface`'s own doc says to switch to it the moment
          a container gains opaque children near its edges — which this one
          always had. It requires a positioned host, a radius, and clipped
          overflow; all three are on the div below.

          The surface stays on a non-scrolling outer box; the cap and the scroll
          stay together on the inner one — which is the constraint the earlier
          note here was about: `max-h-96` on CodeView's own className capped a
          div whose `overflow` is `visible`, so expanding a collapsed hunk pushed
          content past the cap with nothing to scroll. That still holds; it just
          does not require the surface to ride along. */}
      <div
        className={cn("relative overflow-hidden rounded-lg", elevatedSurface(3))}
      >
        <div className="max-h-96 overflow-y-auto">
          {/* `items` is memoised alongside the diff — see above. A fresh array
              literal here re-entered the highlight pipeline on every render even
              when the diff itself was unchanged. */}
          <CodeView
            items={items}
            options={diffOptions}
            disableWorkerPool
          />
        </div>
      </div>
    </div>
  );
}
