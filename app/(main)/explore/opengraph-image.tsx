import { sectionOgImage } from "@/lib/og/images";
import { OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og/theme";

export const alt = "Explore skills on SkillBundle";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return sectionOgImage({
    word: "Explore",
    subtitle:
      "What the community is building right now. Trending and hot skills, ranked by real installs.",
  });
}
