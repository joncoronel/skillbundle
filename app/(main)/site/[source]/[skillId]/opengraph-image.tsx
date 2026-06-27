import { skillOgImage } from "@/lib/og/images";
import { OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og/theme";

export const alt = "Skill on SkillBundle";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({
  params,
}: {
  params: Promise<{ source: string; skillId: string }>;
}) {
  const { source, skillId } = await params;
  return skillOgImage(source, skillId);
}
