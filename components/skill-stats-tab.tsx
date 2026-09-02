import "server-only";
import { notFound } from "next/navigation";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { SkillSection } from "@/components/skill-section";
import { InstallChart } from "@/components/skill-install-chart";
import { MIN_POINTS, intFmt, weekGain } from "@/components/skill-chart-shared";
import { formatInstalls } from "@/lib/utils";
import { loadSkill } from "@/lib/skill-cache";
import { loadSkillSyncData } from "@/components/skill-detail-page";

/**
 * The Stats tab's body: the full install history chart, promoted from the
 * dialog the record card used to open. The dialog capped it at 672px and made
 * it a detour; here it gets the reading column and a URL.
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

  return (
    <SkillSection
      id="stats"
      title="Installs"
      rule={false}
      description="Cumulative total and daily installs, recorded once a day from skills.sh."
      className="mt-8 max-w-3xl"
    >
      <dl className="flex flex-wrap gap-x-10 gap-y-4">
        <StatFigure label="Total">
          {installs != null ? (
            formatInstalls(installs)
          ) : (
            <span
              className="text-muted-foreground"
              aria-label="Install count unavailable"
            >
              —
            </span>
          )}
        </StatFigure>
        <StatFigure label="Past 7 days">
          {gain != null ? (
            <span className="text-success-foreground">+{intFmt(gain)}</span>
          ) : (
            <span className="text-muted-foreground">No change</span>
          )}
        </StatFigure>
        {installRank != null && (
          <StatFigure label="Rank">#{intFmt(installRank)}</StatFigure>
        )}
      </dl>

      {hasChart ? (
        <div className="mt-8">
          <InstallChart insights={insights} />
        </div>
      ) : (
        <p className="mt-8 max-w-prose text-sm text-muted-foreground">
          {skill.isGitHubOnly
            ? "This skill is available only on GitHub, so skills.sh records no install counts for it."
            : "Recording daily. The chart appears once there's enough history."}
        </p>
      )}
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
      className="mt-8 max-w-3xl"
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
