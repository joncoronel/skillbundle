import { brandOgImage } from "@/lib/og/images";
import { OG_SIZE, OG_CONTENT_TYPE, SITE_OG_IMAGE } from "@/lib/og/theme";

// Site-wide default OG image. A route with no opengraph-image of its own
// inherits this one, but only while it leaves `openGraph` unset. A page that
// sets `openGraph` must list `SITE_OG_IMAGE` itself.
export const alt = SITE_OG_IMAGE.alt;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return brandOgImage();
}
