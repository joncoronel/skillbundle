import "server-only";
import { notFound } from "next/navigation";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { SkillSection } from "@/components/skill-section";
import { SkillCopies, type CopyEntry } from "@/components/skill-copies";
import { loadSkill, loadSkillSyncData } from "@/lib/skill-cache";

/**
 * The Copies tab's body.
 *
 * Builds one ranked set out of three sources the query returns separately: the
 * skill you are on, aliases (the same GitHub repo under another name, before or
 * after a rename), and forks (a different repo publishing identical content).
 * Including the current skill is what makes the ranking answer a question:
 * without it the list shows ten numbers and no way to place your own.
 */
export async function SkillCopiesTab({
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

  const { copies, insights } = syncData;

  const entries: CopyEntry[] = [
    { source, skillId, installs: insights.installs ?? 0, kind: "self" },
    ...copies.aliases.map((a) => ({
      source: a.source,
      skillId: a.skillId,
      installs: a.installs,
      // `isLive` marks the repo's current name; every other alias is a name it
      // used to have. Both install fine, because GitHub 301s an old repo name
      // and the CLI clones through the redirect.
      kind: (a.isLive ? "current-name" : "former-name") as CopyEntry["kind"],
    })),
    ...copies.forks.map((f) => ({
      source: f.source,
      skillId: f.skillId,
      installs: f.installs,
      kind: "other-repo" as const,
    })),
  ];

  return <SkillCopies entries={entries} className="mt-8" />;
}

/** Suspense fallback and `loading.tsx` body for the Copies tab. */
export function SkillCopiesTabSkeleton() {
  return (
    <SkillSection
      id="copies"
      title="Copies"
      titleHidden
      summary={<Skeleton className="h-4 w-52" />}
      rule={false}
      description="The same skill content is published in more than one place. Installs are counted per repo, so no single number here is the whole picture. Any of these install commands works."
      className="mt-8"
    >
      <div>
        {[0, 1, 2].map((row) => (
          <div key={row} className="py-3.5">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="mt-2.5 h-1.5 w-full rounded-full" />
          </div>
        ))}
      </div>
    </SkillSection>
  );
}
