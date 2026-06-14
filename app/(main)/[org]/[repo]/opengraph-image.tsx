import { sourceOgImage } from "@/lib/og/images";
import { OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og/theme";

export const alt = "Repository skills on SkillBundle";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export const revalidate = 86400;

export default async function Image({
  params,
}: {
  params: Promise<{ org: string; repo: string }>;
}) {
  const { org, repo } = await params;
  return sourceOgImage(`${org}/${repo}`, "Repository");
}
