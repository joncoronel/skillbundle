import type { ReactNode } from "react";
import { SkillSection } from "@/components/skill-section";
import { formatDate } from "@/lib/utils";
import { HistoryRow, type VersionEntry } from "@/components/skill-history-row";

/**
 * The History section — a Server Component.
 *
 * Previously this deferred itself behind an IntersectionObserver and then
 * opened a Convex websocket subscription to fetch its own data. That existed to
 * avoid mounting an unconditional live subscription on the app's
 * highest-traffic route for a region most readers never scroll to — a real
 * problem, but deferring only moved it.
 *
 * The data is now loaded by `loadSkillSyncData` in lib/skill-cache.ts, in the
 * same `Promise.all` as the rest of the page and behind the same `'use cache'` +
 * `cacheTag("skill-sync")` treatment. That solves the original concern more
 * completely — there is no subscription at all now, deferred or otherwise — and
 * removes the two consequences of the old approach: a second spinner after the
 * page had already loaded, and the layout shift as this section went from an
 * empty placeholder, to a spinner, to a full list.
 *
 * It also stops costing a Convex call per reader; the list is now cached with
 * the page and served from the CDN.
 *
 * `versions` is a prop rather than fetched here so the awaits stay in one place
 * and this section can't accidentally serialise behind the rest of the body.
 *
 * The diff renderer is still lazy — see skill-history-row.tsx. That one is
 * genuinely per-interaction and pulls the shiki bundle.
 */
export function SkillHistory({
  versions,
  empty,
  className,
}: {
  versions: VersionEntry[];
  /** Rendered in place of the timeline when there are no versions. */
  empty: ReactNode;
  className?: string;
}) {
  // Oldest entry last: the query returns newest first.
  const earliest = versions.at(-1);
  // The oldest row is a starting point, not an edit: it records the file as it
  // stood when SkillBundle began watching it, which for a skill that entered
  // the catalog before August 2026 is long after it was published. Counting it
  // as a change produced "1 change since Aug 9" on a file that has never
  // changed.
  //
  // Derived from the row count rather than from `isBaseline`, because that flag
  // is NOT what decides how the row reads: `HistoryRow` renders an anchor when
  // `version.isBaseline || !previous`, so the oldest row always displays as
  // "First recorded" even when it carries no baseline flag (rows archived
  // before baselines existed). Counting the flag alone said "6 changes" over a
  // timeline showing five edits and a first-recorded row. This number has to
  // match what the reader can count on screen, so it comes from the same rule.
  const changes = Math.max(versions.length - 1, 0);
  // Not "since it entered the catalog": the earliest row is when tracking
  // started, and the two dates are different for most of the catalog.
  const trackedSince = earliest ? formatDate(earliest.changedAt) : null;

  return (
    <SkillSection
      id="history"
      title="History"
      titleHidden
      summary={
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {changes === 0
              ? "No changes"
              : `${changes} ${changes === 1 ? "change" : "changes"}`}
          </span>
          {trackedSince && <> · tracked since {trackedSince}</>}
        </p>
      }
      // This section renders as the History tab's whole pane; the tab strip's
      // divider already rules its top.
      rule={false}
      className={className}
      // Says out loud whose record this is. A reader landing mid-page had no
      // way to tell this timeline apart from something the skill's author
      // wrote — it is the one section on the page that exists only because
      // SkillBundle watches the file.
      description="Edits SkillBundle has recorded since it began tracking this file, which is not the same as when the skill was published. Not written by the skill's author."
    >
      {versions.length === 0 ? (
        empty
      ) : (
        <ol>
          {/* The spine is drawn per row now, not once over the list. One
              absolute element could start at the first marker but had no way to
              end at the last one, so it was pinned to a guessed `bottom-8` and
              drifted whenever the earliest row changed height. Each row draws
              its own segment down to the next marker instead, and the last row
              draws none, so the timeline still ends at the earliest entry
              rather than trailing off. See HistoryRow. */}
          {versions.map((version, i) => (
            <HistoryRow
              key={version.versionId}
              version={version}
              // The row below is chronologically previous, since the query
              // returns newest first.
              previous={versions[i + 1]}
              // Only the newest row offers a lookback range; see HistoryRow.
              olderVersions={i === 0 ? versions.slice(1) : undefined}
              isLatest={i === 0}
            />
          ))}
        </ol>
      )}
    </SkillSection>
  );
}
