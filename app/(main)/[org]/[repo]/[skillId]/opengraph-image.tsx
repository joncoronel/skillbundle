import { skillOgImage } from "@/lib/og/images";
import { OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og/theme";

export const alt = "Skill on SkillBundle";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

// Mirror the page: each skill image is generated on first request and cached
// for a day (the loader inside skillOgImage is unstable_cache'd).
export const revalidate = 86400;

export default async function Image({
  params,
}: {
  params: Promise<{ org: string; repo: string; skillId: string }>;
}) {
  const { org, repo, skillId } = await params;
  return skillOgImage(`${org}/${repo}`, skillId);
}
