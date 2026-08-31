import type { Metadata } from "next";

import { AddSkillFlow } from "@/components/add-skill/add-skill-flow";
import { AddOutcomes } from "@/components/add-skill/add-outcomes";

export const metadata: Metadata = {
  title: "Add a skill",
  description:
    "Add an AI coding skill to SkillBundle from skills.sh or straight from a GitHub repo.",
};

export default function AddSkillPage() {
  return (
    // `max-w-2xl`, down from `4xl`, and single column. The page holds one task
    // and one field; the two-column grid it had asserted two peers, and its
    // right-hand column was help prose that vanished into nothing for the
    // signed-out visitor who is the default case here. A narrower centred
    // measure also puts the outcomes' result column inside prose measure
    // without capping it by hand.
    <div className="mx-auto max-w-2xl px-4 pt-12 pb-24">
      <header className="max-w-prose">
        <h1 className="text-display">Add a skill.</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Missing a skill? Paste its skills.sh link or its GitHub repo and
          we&apos;ll add it to the catalog for everyone.
        </p>
      </header>

      {/* No autoFocus here: on page load it would jump focus past the h1 and
          pop the mobile keyboard. The dialog entry point keeps it, where the
          user explicitly asked to add. */}
      <div className="mt-10">
        <AddSkillFlow />
      </div>

      {/* `mt-10`, the standard section gap, not the harder `mt-12 lg:mt-14`
          break: the readout panel closes with a border, so the separation is
          already drawn and the larger step read as a hole under it. */}
      <div className="mt-10">
        <AddOutcomes />
      </div>
    </div>
  );
}
