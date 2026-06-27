"use client";

import { useState } from "react";
import NumberFlow from "@number-flow/react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { ArrowRight01Icon, StarIcon } from "@hugeicons/core-free-icons";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/cubby-ui/dialog";
import { OfficialBadge } from "@/components/skill-badges";
import {
  AuditAccordion,
  AuditBadge,
  type SkillAuditEntry,
} from "@/components/skill-audit-section";
import { InstallChart } from "@/components/skill-install-chart";
import {
  InstallSparkline,
  InstallSparklineGhost,
} from "@/components/skill-install-sparkline";
import {
  MIN_POINTS,
  intFmt,
  weekGain,
  weekWindow,
  type SkillInsights,
  type SparklineHoverState,
} from "@/components/skill-chart-shared";
import { formatInstalls } from "@/lib/utils";

export function SkillSidebar({
  source,
  skillId,
  externalUrl,
  externalIcon,
  externalLabel,
  curatedOwner,
  installs,
  insights,
  updatedKind,
  updatedDate,
  audits,
  stars,
}: {
  source: string;
  skillId: string;
  externalUrl: string;
  externalIcon: IconSvgElement;
  externalLabel: string;
  curatedOwner?: string;
  installs: number;
  insights: SkillInsights;
  updatedKind: string;
  updatedDate: string;
  audits: SkillAuditEntry[] | null;
  stars: number | null;
}) {
  const { snapshots, installRank } = insights;
  const hasChart = snapshots.length >= MIN_POINTS;
  const gain = weekGain(snapshots);
  // The sparkline is a recent-momentum glance over the trailing week. It reads
  // the same window as `weekGain`, so its leftmost point is exactly the baseline
  // the "+N past 7d" stat counts from (they can't drift apart). Full history
  // stays available in the "View details" dialog below.
  const sparkPoints = weekWindow(snapshots);

  // Hovering the sparkline scrubs the headline number to that day's total.
  const [hover, setHover] = useState<SparklineHoverState>(null);

  return (
    <div className="flex flex-col gap-7">
      {/* Installs — count, percentile/momentum, and a sparkline that opens the
          full chart. */}
      <SideSection label="Installs">
        {/* NumberFlow rolls the digits as the scrub changes the value (and on
            revert); compact notation keeps the width stable. The wrapper
            reserves NumberFlow's animated height (it grows ~8px once it first
            animates, since the digit-roll mask adds vertical space) so the
            stats line below never shifts. */}
        <div className="flex min-h-11 items-center">
          <NumberFlow
            value={hover ? hover.value : installs}
            format={{ notation: "compact", maximumFractionDigits: 1 }}
            className="text-2xl font-semibold leading-none text-foreground"
            aria-label={`${installs} installs`}
          />
        </div>

        {/* Reserve a line so swapping the stats for the hovered date doesn't
            shift the sparkline below. */}
        <div className="mt-1.5 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {hover ? (
            <span className="tabular-nums">{formatDay(hover.day)}</span>
          ) : (
            <>
              {installRank != null && (
                <span className="tabular-nums text-foreground">
                  Rank #{intFmt(installRank)}
                </span>
              )}
              {gain != null && (
                <>
                  {installRank != null && <Dot />}
                  <span className="tabular-nums text-success-foreground">
                    +{intFmt(gain)}{" "}
                    <span className="text-muted-foreground">past 7d</span>
                  </span>
                </>
              )}
            </>
          )}
        </div>

        {hasChart ? (
          <Dialog>
            <div className="mt-3">
              <InstallSparkline points={sparkPoints} onHover={setHover} />
            </div>
            <DialogTrigger
              render={
                <button
                  type="button"
                  className="mt-1 inline-flex items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50"
                />
              }
            >
              View details
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                strokeWidth={2}
                className="size-3"
              />
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Installs over time</DialogTitle>
                <DialogDescription>
                  Cumulative total and daily installs, recorded once a day.
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
                <InstallChart insights={insights} />
              </DialogBody>
            </DialogContent>
          </Dialog>
        ) : (
          // Pre-chart state: a ghost of the sparkline that fades out to the
          // right — the history not yet recorded — so it reads as a placeholder
          // for where the trend will live, with no countdown.
          <div className="mt-3">
            <InstallSparklineGhost />
            <p className="mt-2 text-xs text-pretty text-muted-foreground">
              Recording daily. The trend appears once there&apos;s enough
              history.
            </p>
          </div>
        )}
      </SideSection>

      {/* Repository / source */}
      <SideSection label="Repository">
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex max-w-full items-center gap-1.5 text-sm text-foreground transition-colors hover:text-primary hover:underline"
        >
          <HugeiconsIcon
            icon={externalIcon}
            strokeWidth={2}
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <span className="truncate">{externalLabel}</span>
          {curatedOwner && <OfficialBadge owner={curatedOwner} />}
        </a>
      </SideSection>

      {stars != null && (
        <SideSection label="GitHub stars">
          <span className="inline-flex items-center gap-1.5 text-sm tabular-nums text-foreground">
            <HugeiconsIcon
              icon={StarIcon}
              strokeWidth={2}
              className="size-3.5 text-muted-foreground"
            />
            {formatInstalls(stars)}
          </span>
        </SideSection>
      )}

      <SideSection label={updatedKind}>
        <span className="text-sm text-foreground">{updatedDate}</span>
      </SideSection>

      {audits && audits.length > 0 && (
        <SideSection label="Security">
          <ul className="space-y-2">
            {audits.map((audit) => (
              <li
                key={audit.slug}
                className="flex items-center justify-between gap-2"
              >
                <span className="truncate text-sm text-foreground">
                  {audit.provider}
                </span>
                <AuditBadge status={audit.status} className="shrink-0" />
              </li>
            ))}
          </ul>
          <Dialog>
            <DialogTrigger
              render={
                <button
                  type="button"
                  className="mt-3 inline-flex items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50"
                />
              }
            >
              View details
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                strokeWidth={2}
                className="size-3"
              />
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Security audits</DialogTitle>
                <DialogDescription>
                  Independent checks from skills.sh&apos;s audit partners.
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
                <AuditAccordion
                  source={source}
                  skillId={skillId}
                  audits={audits}
                />
              </DialogBody>
            </DialogContent>
          </Dialog>
        </SideSection>
      )}
    </div>
  );
}

function SideSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="font-mono text-eyebrow font-medium uppercase tracking-eyebrow text-muted-foreground">
        {label}
      </h3>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function Dot() {
  return (
    <span aria-hidden="true" className="text-border">
      ·
    </span>
  );
}

/** "2026-05-30" → "May 30, 2026" (UTC noon so the label never slips a day). */
function formatDay(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
