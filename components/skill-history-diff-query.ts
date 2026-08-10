import type { api } from "@/convex/_generated/api";

/**
 * Query options for a version diff's raw content, in their own module so both
 * sides can reach them without pulling the renderer.
 *
 * The row (skill-history-row.tsx) prefetches with these before it opens, and
 * VersionDiff (skill-history-diff.tsx) reads with the same key so it finds the
 * result already cached and renders at its final height immediately. That only
 * works if the key and fetcher are literally the same, hence one definition.
 *
 * Critically this file imports nothing from `@pierre/diffs`. The row imports it
 * statically, and `@pierre/diffs`'s main entry drags in the full shiki bundle —
 * putting these few lines beside the renderer would undo the code splitting the
 * dynamic import exists for.
 */

type VersionEntry =
  (typeof api.skillVersions.listForSkill)["_returnType"][number];

export function versionDiffQueryOptions(
  from: Pick<VersionEntry, "versionId" | "contentUrl">,
  to: Pick<VersionEntry, "versionId" | "contentUrl">,
) {
  return {
    queryKey: ["skillVersionDiff", from.versionId, to.versionId] as const,
    queryFn: async () => {
      if (!from.contentUrl || !to.contentUrl) {
        throw new Error("Version content is unavailable");
      }
      const [before, after] = await Promise.all([
        fetch(from.contentUrl).then((r) => r.text()),
        fetch(to.contentUrl).then((r) => r.text()),
      ]);
      return { before, after };
    },
    // Version content is immutable once written, so it never needs revalidating
    // and re-expanding a row should be instant.
    staleTime: Infinity,
    gcTime: Infinity,
  };
}
