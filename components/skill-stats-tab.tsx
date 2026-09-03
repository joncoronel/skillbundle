import "server-only";
import { notFound } from "next/navigation";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { SkillSection } from "@/components/skill-section";
import { SkillTabEmpty } from "@/components/skill-tab-empty";
import { InstallChart } from "@/components/skill-install-chart";
import { InstallSparklineGhost } from "@/components/skill-install-sparkline";
import { MIN_POINTS, intFmt, weekGain } from "@/components/skill-chart-shared";
import { formatInstalls } from "@/lib/utils";
import { loadSkill, loadSkillSyncData } from "@/lib/skill-cache";

/**
 * The Stats tab's body: the full install history chart, promoted from the
 * dialog the record card used to open. The dialog capped it at 672px and made
 * it a detour; here it gets the whole page width and a URL.
 *
 * Full width, unlike the History and Security panes, which cap at a reading
 * measure. A chart is not prose: it has no line length to protect, more width
 * is more resolution, and at 768px under a 1152px tab strip the pane read as
 * a column with a hole beside it.
 *
 * The figure row above the chart repeats the record card's numbers on purpose —
 * this tab has no sidebar, so the totals the chart illustrates have to live on
 * the page — plus the one number the card deliberately leaves out: install
 * rank. The card's comment argues rank answers a leaderboard question rather
 * than a "should I depend on this" one, which is exactly what makes it belong
 * here and not there.
 */
export async function SkillStatsTab({
  source,
  skillId,
}: {
  source: string;
  skillId: string;
}) {
  const [skill, syncData] = await Promise.all([
    loadSkill(source, skillId),
    loadSkillSyncData(source, skillId),
  ]);
  if (!skill) notFound();

  const { insights } = syncData;
  const { installs, installRank, snapshots } = insights;
  const hasChart = snapshots.length >= MIN_POINTS;
  const gain = weekGain(snapshots);
  // GitHub-only rows carry `installs: 0` (convex/githubOnly.ts), a placeholder
  // rather than a count, so the figures are gated on the flag as well as on
  // null. An orphaned row (a `skills` row with no `skillSummaries` mirror)
  // reports null and is NOT GitHub-only; it gets neutral copy, not the
  // "only on GitHub" explanation.
  const hasCount = installs != null && !skill.isGitHubOnly;

  return (
    <SkillSection
      id="stats"
      title="Installs"
      rule={false}
      description="Cumulative total and daily installs, recorded once a day from skills.sh."
      className="mt-8"
    >
      {hasCount && (
        <dl className="flex flex-wrap gap-x-10 gap-y-4">
          <StatFigure label="Total">{formatInstalls(installs)}</StatFigure>
          <StatFigure label="Past 7 days">
            {gain != null ? (
              <span className="text-success-foreground">+{intFmt(gain)}</span>
            ) : snapshots.length < MIN_POINTS ? (
              // Not measured yet, which is different from measured at zero.
              <span className="text-muted-foreground">Not yet</span>
            ) : (
              <span className="text-muted-foreground">No change</span>
            )}
          </StatFigure>
          {installRank != null && (
            <StatFigure label="Rank">#{intFmt(installRank)}</StatFigure>
          )}
        </dl>
      )}

      <div className={hasCount ? "mt-8" : undefined}>
        {hasChart ? (
          <InstallChart insights={insights} />
        ) : skill.isGitHubOnly ? (
          <SkillTabEmpty title="No install counts for this skill.">
            <p>
              It is available only on GitHub, not through the skills.sh API, and
              skills.sh is where install counts come from. There is nothing to
              record until it is listed there.
            </p>
          </SkillTabEmpty>
        ) : installs == null ? (
          <SkillTabEmpty title="No install count recorded yet.">
            <p>
              skills.sh has not reported a count for this skill. SkillBundle
              checks daily, and the figures and chart appear here once it does.
            </p>
          </SkillTabEmpty>
        ) : (
          <SkillTabEmpty title="Recording daily.">
            {/* The same ghost trend the record card shows before it has a
                line: a stand-in for where the chart will live, not a chart. */}
            <div className="max-w-xs">
              <InstallSparklineGhost />
            </div>
            <p>
              skills.sh only exposes a point-in-time count, so SkillBundle
              snapshots it once a day and rebuilds the history from those. The
              chart appears with the second snapshot, and the trend fills in
              from there.
            </p>
          </SkillTabEmpty>
        )}
      </div>
    </SkillSection>
  );
}

function StatFigure({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 text-2xl leading-none font-semibold text-foreground tabular-nums">
        {children}
      </dd>
    </div>
  );
}

/** Suspense fallback and `loading.tsx` body for the Stats tab. */
export function SkillStatsTabSkeleton() {
  return (
    <SkillSection
      id="stats"
      title="Installs"
      rule={false}
      description="Cumulative total and daily installs, recorded once a day from skills.sh."
      className="mt-8"
    >
      <div className="flex flex-wrap gap-x-10 gap-y-4">
        {[0, 1].map((figure) => (
          <div key={figure}>
            <Skeleton className="h-3 w-14" />
            <Skeleton className="mt-2 h-6 w-20" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-8 h-72 w-full" />
    </SkillSection>
  );
}
