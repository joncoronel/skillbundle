import { sectionOgImage } from "@/lib/og/images";
import { OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og/theme";

export const alt = "Compare skills on SkillBundle";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return sectionOgImage({
    word: "Compare",
    subtitle:
      "Docs, install counts, and sources side by side. Pick the skill that earns the spot in your bundle.",
  });
}
