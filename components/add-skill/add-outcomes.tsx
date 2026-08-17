import { LabeledSection } from "@/components/labeled-section";
import { GitHubAddQuota } from "@/components/add-skill/github-add-quota";

/**
 * The three answers a submit can come back with, as a condition/result
 * register rather than the prose list this replaced.
 *
 * Every fact here was already on the page; what was missing was that they are
 * BRANCHES of one action. Three bold-lead paragraphs in a sidebar column read
 * as notes-to-self, and hid the one asymmetry that matters to a free user:
 * only the middle branch is metered, which is why the quota meter is mounted
 * inside it rather than parked in a box of its own.
 *
 * Deliberately not a grid of cards. Equal cards would assert that the three
 * outcomes are peers of equal weight, and they are not: two add something and
 * one does not.
 */

const OUTCOMES: ReadonlyArray<{
  condition: string;
  result: string;
  /** Mounts the quota meter under the result. Only the GitHub-only branch is
   *  capped on the free plan, so only it carries one. */
  metered?: boolean;
}> = [
  {
    condition: "It's on skills.sh",
    result:
      "It joins the catalog as a normal entry, with its real install count, rank, and security audit, even if the daily sync hadn't reached it yet. There's no limit on these.",
  },
  {
    condition: "It's only in a GitHub repo",
    result:
      "We find the SKILL.md in the repo and show you the file before anything is written. Confirm it and the skill joins with a GitHub-only badge, no install count and no audit, until the day skills.sh lists it and we adopt it as a normal skill.",
    metered: true,
  },
  {
    condition: "It's already in the catalog",
    result:
      "We say so and link you straight to the skill, including when it turns out to be filed under a different slug than the one you pasted. Nothing is added twice.",
  },
] as const;

export function AddOutcomes() {
  return (
    <LabeledSection label="What happens when you submit">
      {/* A description list, because that is the relationship: each condition
          names the case, each definition is what the app does about it. The
          hairline between rows and the fixed term column do the separating, so
          no row needs a container of its own. */}
      <dl className="divide-y divide-border border-y border-border">
        {OUTCOMES.map((outcome) => (
          <div
            key={outcome.condition}
            className="py-4 sm:grid sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-x-6"
          >
            <dt className="text-sm font-medium text-foreground">
              {outcome.condition}
            </dt>
            <dd className="mt-1.5 text-sm text-muted-foreground sm:mt-0">
              {outcome.result}
              {outcome.metered && <GitHubAddQuota className="mt-3" />}
            </dd>
          </div>
        ))}
      </dl>
    </LabeledSection>
  );
}
