import type { ReactNode } from "react";

import { GitHubAddQuota } from "@/components/add-skill/github-add-quota";

/**
 * The three answers a submit can come back with, one line each.
 *
 * A previous version was a three-row register with a paragraph per row. The
 * facts are the same; what changed is that the entry preview above now says
 * which path an input is heading for, so this only has to name the branches,
 * not explain them. Deliberately not cards: two of the three add something and
 * one does not, and equal cards would assert they are peers.
 */
function Outcome({
  condition,
  children,
}: {
  condition: string;
  children: ReactNode;
}) {
  return (
    <div className="sm:grid sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-x-6">
      <dt className="text-sm font-medium text-foreground">{condition}</dt>
      <dd className="mt-0.5 text-sm text-muted-foreground sm:mt-0">
        {children}
      </dd>
    </div>
  );
}

export function AddOutcomes() {
  return (
    <section aria-labelledby="add-outcomes-heading">
      <h2
        id="add-outcomes-heading"
        className="mb-3 text-sm font-semibold text-foreground"
      >
        After you submit
      </h2>
      <dl className="space-y-3">
        <Outcome condition="On skills.sh">
          It joins with its real install count, rank and security audit. No
          limit.
        </Outcome>
        <Outcome condition="Only on GitHub">
          We show you the SKILL.md and you confirm before anything is written.
          {/* The cap is stated as static copy because the meter below renders
              nothing for a signed-out visitor, who is the default case here,
              and nothing for a Pro user either. */}{" "}
          Capped on the free plan, unlimited on Pro.
          <GitHubAddQuota className="mt-2" />
        </Outcome>
        <Outcome condition="Already listed">
          We link you to it, even when it lives under a different slug than the
          one you pasted. Nothing is added twice.
        </Outcome>
      </dl>
    </section>
  );
}
