import { sectionOgImage } from "@/lib/og/images";
import { OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og/theme";
import { FREE_WATCHED_SKILLS, PLANS } from "@/lib/plans";

export const alt = "SkillBundle pricing";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/**
 * Built from the same constants as the page's own metadata, not hand-written.
 *
 * This card was still selling "unlimited bundles" — a cap that no longer
 * exists — and auto-detection as the thing Pro buys, while the page beside it
 * had been rewritten to the watched-skills pitch. A static section card is
 * baked at build, so the wrong copy ships until someone notices. lib/plans.ts
 * states the standing rule that pricing copy changes in the same commit as the
 * gates; deriving it is how that rule stops depending on anyone remembering.
 */
export default function Image() {
  return sectionOgImage({
    word: "Pricing",
    subtitle: `Watch ${FREE_WATCHED_SKILLS} skills free, security warnings included. Pro is $${PLANS.pro.priceMonthly}/month for unlimited watching.`,
  });
}
