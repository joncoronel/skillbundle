import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { LabeledSection } from "@/components/labeled-section";
import { skillHref } from "@/lib/skill-urls";
import { formatInstalls } from "@/lib/utils";

type AliasCopy = {
  source: string;
  skillId: string;
  installs: number;
  isLive: boolean;
};
type ForkCopy = { source: string; skillId: string; installs: number };

/**
 * "Also available at" — surfaces a skill's copies so the user can pick which to
 * install. Two groups: aliases (the same GitHub repo under other names, e.g.
 * after a rename) and forks (different repos with identical SKILL.md content).
 * Renders nothing when the skill has no copies (the common case).
 */
export function SkillCopies({
  aliases,
  forks,
  className,
}: {
  aliases: AliasCopy[];
  forks: ForkCopy[];
  className?: string;
}) {
  if (aliases.length === 0 && forks.length === 0) return null;

  const sortedAliases = [...aliases].sort((a, b) => b.installs - a.installs);
  const sortedForks = [...forks].sort((a, b) => b.installs - a.installs);

  return (
    <LabeledSection label="Also available at" className={className}>
      <p className="-mt-1 mb-5 max-w-prose text-sm text-pretty text-muted-foreground">
        The same skill content is published under more than one repo. The install
        counts are split across them; any of these commands works.
      </p>

      <div className="space-y-7">
        {sortedAliases.length > 0 && (
          <CopyGroup title="Other names for this repo">
            {sortedAliases.map((c) => (
              <CopyRow
                key={`${c.source}/${c.skillId}`}
                source={c.source}
                skillId={c.skillId}
                installs={c.installs}
                tag={c.isLive ? "live" : "renamed"}
              />
            ))}
          </CopyGroup>
        )}

        {sortedForks.length > 0 && (
          <CopyGroup title="Different repos, same content">
            {sortedForks.map((c) => (
              <CopyRow
                key={`${c.source}/${c.skillId}`}
                source={c.source}
                skillId={c.skillId}
                installs={c.installs}
              />
            ))}
          </CopyGroup>
        )}
      </div>
    </LabeledSection>
  );
}

function CopyGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-medium text-foreground">{title}</h3>
      <ul className="divide-y divide-border">{children}</ul>
    </div>
  );
}

function CopyRow({
  source,
  skillId,
  installs,
  tag,
}: {
  source: string;
  skillId: string;
  installs: number;
  tag?: "live" | "renamed";
}) {
  return (
    <li>
      <Link
        href={skillHref(source, skillId)}
        className="group -mx-3 flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-sm text-foreground">
            {source}
          </span>
          {tag === "live" && <CopyTag variant="live">Live</CopyTag>}
          {tag === "renamed" && <CopyTag variant="renamed">Renamed</CopyTag>}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
          {formatInstalls(installs)} installs
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            strokeWidth={2}
            className="size-3.5 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
          />
        </span>
      </Link>
    </li>
  );
}

function CopyTag({
  variant,
  children,
}: {
  variant: "live" | "renamed";
  children: React.ReactNode;
}) {
  return (
    <span
      className={
        variant === "live"
          ? "shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary"
          : "shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
      }
    >
      {children}
    </span>
  );
}
