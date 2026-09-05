import type { Metadata } from "next";

import { AddSkillFlow } from "@/components/add-skill/add-skill-flow";
import { AddOutcomes } from "@/components/add-skill/add-outcomes";

export const metadata: Metadata = {
  title: "Add a skill",
  description:
    "Add an AI coding skill to SkillBundle from skills.sh or straight from a GitHub repo.",
};

/*
 * Direction contract (seed d1de75fb, grounded candidate 3).
 *
 * THESIS: the field writes the catalog entry it would create, live. The page
 * refuses the form-plus-help-prose arrangement it had, where the field was one
 * control among a label, a help line, a gray reference panel and a register.
 * OWN-WORLD: the house control panel. One inset frame (the home composer's
 * object) holds the field, its action, and the preview row on lifted white,
 * with the muted gutter as the only edge. The action is the neutral
 * near-black button, not signal blue: blue would be the only saturated mark
 * in a page that already has one object, and the header pill's sign-up
 * button holds the page's one blue.
 * STORY: paste, watch the entry resolve, submit. Three outcomes named in one
 * line each underneath, never explained twice.
 * FIRST VIEWPORT: title and one sentence; the instrument at full measure with
 * the action beside the field; the outcomes list; nothing else.
 * FORM: entry preview, candidate 3 of 7.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 * finish review, the verdict, and DESIGN.md.
 */
export default function AddSkillPage() {
  return (
    // `max-w-2xl`, single column. The page holds one task and one object; a
    // narrower centred measure also keeps the outcomes' result column inside
    // prose measure without capping it by hand.
    <div className="mx-auto max-w-2xl px-4 pt-12 pb-24">
      <header className="max-w-prose">
        <h1 className="text-display">Add a skill.</h1>
        <p className="mt-3 text-sm text-pretty text-muted-foreground">
          Missing a skill? Paste its skills.sh link or its GitHub repo and
          we&apos;ll add it to the catalog for everyone.
        </p>
      </header>

      {/* No autoFocus here: on page load it would jump focus past the h1 and
          pop the mobile keyboard. The dialog entry point keeps it, where the
          user explicitly asked to add. */}
      <div className="mt-8">
        <AddSkillFlow />
      </div>

      {/* One standard section gap. The frame closes with its own edge, so a
          harder break read as a hole under it. */}
      <div className="mt-10">
        <AddOutcomes />
      </div>
    </div>
  );
}
