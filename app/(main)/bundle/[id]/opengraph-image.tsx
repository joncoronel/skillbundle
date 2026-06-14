import { bundleOgImage } from "@/lib/og/images";
import { OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og/theme";

export const alt = "Bundle on SkillBundle";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

// Shorter cache than skills: bundles are edited more often, and the card lists
// their current skills. Only public bundles resolve (no auth token in the
// image route) — private ones fall back to the brand card.
export const revalidate = 3600;

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return bundleOgImage(id);
}
