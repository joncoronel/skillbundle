import type { ReactNode } from "react";

import { LabeledSection } from "@/components/labeled-section";
import { GitHubAddQuota } from "@/components/add-skill/github-add-quota";

/**
 * The three answers a submit can come back with, as a condition/result
 * register rather than the prose list this replaced.
 *
 * Every fact here was already on the page; what was missing was that they are
 * BRANCHES of one action. Deliberately not a grid of cards: equal cards would
 * assert the three are peers of equal weight, and two of them add something
 * while one does not.
 */

/** One condition/result pair. A `<div>` inside a `<dl>` is spec-legal. */
function Outcome({
  condition,
  children,
}: {
  condition: string;
  children: ReactNode;
}) {
  return (
    <div className="py-4 sm:grid sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-x-6">
      <dt className="text-sm font-medium text-foreground">{condition}</dt>
      <dd className="mt-1.5 text-sm text-muted-foreground sm:mt-0">
        {children}
      </dd>
    </div>
  );
}

export function AddOutcomes() {
  return (
    <LabeledSection label="What happens when you submit">
      {/* The hairline between rows and the fixed term column do the
          separating, so no row needs a container of its own. */}
      <dl className="divide-y divide-border border-y border-border">
        <Outcome condition="It's on skills.sh">
          It joins the catalog as a normal entry, with its real install count,
          rank, and security audit, even if the daily sync hadn&apos;t reached
          it yet. There&apos;s no limit on these.
        </Outcome>

        <Outcome condition="It's only in a GitHub repo">
          We find the SKILL.md in the repo and show you the file before anything
          is written. Confirm it and the skill joins with a GitHub-only badge,
          no install count and no audit, until the day skills.sh lists it and we
          adopt it as a normal skill.{" "}
          {/* Stated here as static copy because the meter below renders
              nothing for a signed-out visitor, who is the default case on this
              page, and nothing for a Pro user either. Without the clause the
              cap appeared nowhere for either of them, while the row above
              still claimed its own path was unlimited. */}
          Capped on the free plan, unlimited on Pro.
          <GitHubAddQuota className="mt-3" />
        </Outcome>

        <Outcome condition="It's already in the catalog">
          We say so and link you straight to the skill, including when it turns
          out to be filed under a different slug than the one you pasted.
          Nothing is added twice.
        </Outcome>
      </dl>
    </LabeledSection>
  );
}
