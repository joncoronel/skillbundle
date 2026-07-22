import type { Metadata } from "next";

import { AddSkillFlow } from "@/components/add-skill/add-skill-flow";

export const metadata: Metadata = {
  title: "Add a skill",
  description:
    "Add an AI coding skill to SkillBundle from skills.sh or straight from a GitHub repo.",
};

export default function AddSkillPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 pt-12 pb-20">
      <header>
        <h1 className="font-display text-[clamp(2.5rem,5vw,4rem)] font-medium tracking-tight leading-hero text-balance">
          Add a skill.
        </h1>
        <p className="mt-3 max-w-prose text-sm text-muted-foreground">
          Know a skill that isn&apos;t here yet? Paste its skills.sh link or its
          GitHub repo and we&apos;ll add it to the catalog. If it&apos;s not on
          skills.sh yet, we&apos;ll pull it straight from GitHub.
        </p>
      </header>

      <div className="mt-10">
        <AddSkillFlow autoFocus />
      </div>
    </main>
  );
}
