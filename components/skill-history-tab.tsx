import "server-only";
import { notFound } from "next/navigation";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { SkillSection } from "@/components/skill-section";
import { SkillHistory } from "@/components/skill-history";
import { SkillTabEmpty } from "@/components/skill-tab-empty";
import { BundleToggleButton } from "@/components/bundle-toggle-button";
import { loadSkill, loadSkillSyncData } from "@/lib/skill-cache";

/**
 * The History tab's body. The timeline itself is unchanged from when it was a
 * section of the overview (components/skill-history.tsx, including its
 * `id="history"` anchor, which the e2e history spec selects by); what changed
 * is the address — a SKILL.md runs to tens of KB, so as an inline section the
 * timeline and the document were always fighting for the same column. As a tab
 * it gets the full reading measure and its own URL to link to.
 *
 * Data comes through the same `'use cache'` loaders as the Overview, so this
 * tab shares the Overview's cache entries rather than adding its own.
 */
export async function SkillHistoryTab({
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

  return (
    <SkillHistory
      versions={syncData.versions}
      className="mt-8"
      empty={
        <SkillTabEmpty
          title="Nothing has changed yet."
          // The watch action is the product's answer to an empty timeline:
          // the reason to care about this file's history is what it does to
          // an agent the day it changes, and adding the skill to a bundle is
          // how someone finds out. PRODUCT.md calls that the return visit.
          action={
            <BundleToggleButton
              source={source}
              skillId={skillId}
              name={skill.name}
            />
          }
        >
          <p>
            SkillBundle began recording edits to skill files in August 2026, and
            this one has not changed since. When it does, the edit lands here as
            a diff against the version before it.
          </p>
          <p>Add it to a bundle to hear about that change when it happens.</p>
        </SkillTabEmpty>
      }
    />
  );
}

/** Suspense fallback and `loading.tsx` body for the History tab. */
export function SkillHistoryTabSkeleton() {
  return (
    <div className="mt-8">
      {/* Drawn through the real section component so the border, spacing and
          heading scale cannot drift from the page's. Header and description
          are real text: neither depends on the skill's data. */}
      <SkillSection
        id="history"
        title="History"
        titleHidden
        summary={<Skeleton className="h-4 w-44" />}
        rule={false}
        description="Edits SkillBundle has recorded to this file since it entered the catalog. Not written by the skill's author."
      >
        <div className="space-y-3">
          <Skeleton className="h-4 w-full max-w-md" />
          <Skeleton className="h-4 w-full max-w-sm" />
          <Skeleton className="h-4 w-full max-w-lg" />
        </div>
      </SkillSection>
    </div>
  );
}
