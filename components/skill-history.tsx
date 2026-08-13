import { SkillSection } from "@/components/skill-section";
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
 * The data is now loaded by `loadSkillSyncData` in skill-detail-page.tsx, in the
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
  className,
}: {
  versions: VersionEntry[];
  className?: string;
}) {
  return (
    <SkillSection
      id="history"
      title="History"
      className={className}
      // Says out loud whose record this is. A reader landing mid-page had no
      // way to tell this timeline apart from something the skill's author
      // wrote — it is the one section on the page that exists only because
      // SkillBundle watches the file.
      description="Edits SkillBundle has recorded to this file since it entered the catalog. Not written by the skill's author."
      meta={
        versions.length > 0 &&
        `${versions.length} ${versions.length === 1 ? "change" : "changes"}`
      }
    >
      {versions.length === 0 ? (
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
    </SkillSection>
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
