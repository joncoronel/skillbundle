import { sectionOgImage } from "@/lib/og/images";
import { OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og/theme";

export const alt = "Official skills on SkillBundle";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return sectionOgImage({
    word: "Official",
    subtitle:
      "First-party skills from the companies and organizations that build the technology. Curated by skills.sh.",
  });
}
