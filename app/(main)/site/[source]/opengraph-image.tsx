import { sourceOgImage } from "@/lib/og/images";
import { OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og/theme";

export const alt = "Source skills on SkillBundle";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({
  params,
}: {
  params: Promise<{ source: string }>;
}) {
  const { source } = await params;
  return sourceOgImage(source, "Source");
}
