import { orgOgImage } from "@/lib/og/images";
import { OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og/theme";

export const alt = "Organization on SkillBundle";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export const revalidate = 86400;

export default async function Image({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  return orgOgImage(org);
}
