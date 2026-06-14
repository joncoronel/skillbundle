import { brandOgImage } from "@/lib/og/images";
import { OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og/theme";

// Site-wide default OG image. Any route that doesn't define its own
// opengraph-image inherits this one, so every shared link unfurls on brand.
export const alt = "SkillBundle — discover, compare, and bundle AI coding skills";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return brandOgImage();
}
