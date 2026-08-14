import type { Metadata } from "next";

import { AddSkillFlow } from "@/components/add-skill/add-skill-flow";
import { GitHubAddQuota } from "@/components/add-skill/github-add-quota";

export const metadata: Metadata = {
  title: "Add a skill",
  description:
    "Add an AI coding skill to SkillBundle from skills.sh or straight from a GitHub repo.",
};

export default function AddSkillPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 pt-12 pb-20">
      <header className="max-w-prose">
        <h1 className="font-display text-[clamp(2.5rem,5vw,4rem)] font-medium tracking-tight leading-hero">
          Add a skill.
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Missing a skill? Paste its skills.sh link or its GitHub repo and
          we&apos;ll add it to the catalog for everyone.
        </p>
      </header>

      <div className="mt-10 lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start lg:gap-x-12">
        {/* No autoFocus here: on page load it would jump focus past the h1 and
            pop the mobile keyboard. The dialog entry point keeps it, where the
            user explicitly asked to add. */}
        <AddSkillFlow />

        <aside className="mt-10 space-y-6 lg:mt-0">
          <GitHubAddQuota />

          <div>
            <h2 className="text-sm font-medium">How it works</h2>
            <ul className="mt-3 space-y-3.5 text-sm text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">
                  Already on skills.sh?
                </span>{" "}
                It&apos;s added as a normal catalog entry with its real install
                count, even if we hadn&apos;t synced it yet.
              </li>
              <li>
                <span className="font-medium text-foreground">
                  Only on GitHub?
                </span>{" "}
                We pull it from the repo. It shows a GitHub-only badge and
                becomes a normal skill automatically once skills.sh lists it.
              </li>
              <li>
                <span className="font-medium text-foreground">
                  What you can add.
                </span>{" "}
                Any skill that&apos;s on skills.sh, unlimited. GitHub-only
                skills are capped on the free plan, unlimited on Pro.
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </main>
  );
}
