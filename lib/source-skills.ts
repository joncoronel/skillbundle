import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

// Shared loader for the two source-directory routes — the GitHub repo page
// (`/[org]/[repo]`) and the well-known source page (`/site/[source]`). Both list
// the same thing: every non-delisted skill published by one `source`, install-
// sorted, with the total. GitHub (`owner/repo`) and well-known (`domain.tld`)
// sources live in disjoint string namespaces, so one shared `'use cache'` entry
// keyed by `source` never collides.
//
// `'use cache'` isolates `fetchQuery`'s no-store fetch behind a cache boundary so
// the route prerenders, and keys on (function identity + args) so `generateMetadata`
// and the page body share one entry. Tagged "skill-sync" so it busts with the skill
// pages on the daily syncSkills ping and on addSkillManually — otherwise a
// newly-added skill is missing from its directory (or the source 404s) for up to a
// day even though the detail page already renders.
export async function loadSourceSkills(source: string) {
  "use cache";
  cacheLife("days");
  cacheTag("skill-sync");
  const skills = await fetchQuery(api.skills.listBySource, { source });
  const visible = skills
    .filter((s) => !s.isDelisted)
    .sort((a, b) => b.installs - a.installs);
  return {
    skills: visible,
    totalInstalls: visible.reduce((sum, s) => sum + s.installs, 0),
  };
}
