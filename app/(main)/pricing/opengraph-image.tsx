import { sectionOgImage } from "@/lib/og/images";
import { OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og/theme";

export const alt = "SkillBundle pricing";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return sectionOgImage({
    word: "Pricing",
    subtitle:
      "Start free, upgrade when auto-detection and unlimited bundles start paying for themselves.",
  });
}
