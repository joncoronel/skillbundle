import "server-only";
import { notFound } from "next/navigation";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { SkillSection } from "@/components/skill-section";
import {
  COPIES_SECTION,
  SkillCopies,
  type CopyEntry,
  type CopyKind,
} from "@/components/skill-copies";
import {
  hasSkillCopies,
  loadSkill,
  loadSkillSyncData,
} from "@/lib/skill-cache";

/**
 * The Copies tab's body.
 *
 * Builds one ranked set out of three sources the query returns separately: the
 * skill you are on, aliases (the same GitHub repo under another name, before or
 * after a rename), and forks (a different repo publishing identical content).
 * Including the current skill is what makes the ranking answer a question:
 * without it the list shows ten numbers and no way to place your own.
 */
/** Widens the literal to `CopyKind` so the entry list needs no cast. */
function aliasKind(isLive: boolean): CopyKind {
  return isLive ? "current-name" : "former-name";
}

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
  // The TAB is conditional but the ROUTE was not, so every skill without
  // copies still served this page: one row ranking the skill against itself,
  // under a strip where no tab was marked current. Same predicate the strip
  // uses, so the two cannot disagree.
  if (!hasSkillCopies(copies)) notFound();

  const entries: CopyEntry[] = [
    { source, skillId, installs: insights.installs ?? 0, kind: "self" },
    ...copies.aliases.map((a) => ({
      source: a.source,
      skillId: a.skillId,
      installs: a.installs,
      // `isLive` marks the repo's current name; every other alias is a name it
      // used to have. Both install fine, because GitHub 301s an old repo name
      // and the CLI clones through the redirect.
      kind: aliasKind(a.isLive),
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
      {...COPIES_SECTION}
      summary={<Skeleton className="h-4 w-52" />}
      className="mt-8"
    >
      <div>
        {/* The same grid the real row uses, so the placeholder is one line
            above `sm` rather than two. Stacked, each row stood ~14px taller
            than what it stands in for and the page shifted when the pane
            landed. */}
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2.5 py-3.5 sm:grid-cols-[minmax(0,17rem)_8.5rem_minmax(0,1fr)_auto]"
          >
            <Skeleton className="h-5 w-48" />
            <Skeleton className="hidden h-3 w-20 sm:block" />
            <Skeleton className="order-last col-span-2 h-1.5 w-full rounded-full sm:order-none sm:col-span-1" />
            <Skeleton className="h-3 w-20 justify-self-end" />
          </div>
        ))}
      </div>
    </SkillSection>
  );
}
