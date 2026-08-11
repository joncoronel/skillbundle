import { queryOptions } from "@tanstack/react-query";

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

/**
 * One history entry. Declared here, next to the key that is derived from it,
 * and imported by both consumers — it used to be spelled out identically in
 * three files, which left the boundary this module exists to guarantee resting
 * on nobody editing one copy.
 */
export type VersionEntry =
  (typeof api.skillVersions.listForSkill)["_returnType"][number];

/**
 * A comparison, always OLDER → NEWER. Named rather than passed as two
 * positional arguments so callers cannot silently transpose them: reversing the
 * pair renders a diff with additions and deletions swapped, which reads as a
 * plausible but completely wrong history.
 */
export type DiffPair = {
  from: Pick<VersionEntry, "versionId" | "contentUrl">;
  to: Pick<VersionEntry, "versionId" | "contentUrl">;
};

/**
 * Thrown when a version has no stored content at all.
 *
 * Its own type rather than a bare Error so `retry` can tell it apart: this
 * failure is decided from data the caller already holds, before any request, so
 * retrying it only burns backoff before showing the error that was knowable
 * immediately.
 */
class MissingVersionContent extends Error {}

export function versionDiffQueryOptions({ from, to }: DiffPair) {
  // `queryOptions()` rather than a bare object literal: it binds the key to the
  // fetcher's return type, so `queryClient.getQueryData(queryKey)` comes back
  // typed instead of `unknown`. That call is what `isReady()` in
  // skill-history-row.tsx uses to decide whether to show a busy state at all,
  // so it is exactly the place the types should be doing work.
  return queryOptions({
    queryKey: ["skillVersionDiff", from.versionId, to.versionId] as const,
    queryFn: async () => {
      if (!from.contentUrl || !to.contentUrl) {
        throw new MissingVersionContent("Version content is unavailable");
      }
      // `fetch` resolves on 4xx/5xx, so without this check a storage error
      // payload is handed to the diff parser as if it were the file, and the
      // reader gets a confident, fully-rendered diff claiming the whole
      // SKILL.md was replaced by a JSON error object. On a product whose job
      // is reporting what changed, a plausible wrong answer is worse than an
      // error state — and `staleTime: Infinity` would pin it. `loadVersions`
      // is cached for days, so a `contentUrl` can outlive its blob.
      const read = async (url: string) => {
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Version content unavailable (${res.status})`);
        }
        return res.text();
      };
      const [before, after] = await Promise.all([
        read(from.contentUrl),
        read(to.contentUrl),
      ]);
      return { before, after };
    },
    // At most one retry, and none at all when the answer was already known.
    //
    // The failure this query is built to surface is a `contentUrl` whose blob
    // is gone — `loadVersions` is cached for days, so a URL can outlive what it
    // points at. That is permanent, and TanStack's default of three attempts
    // with 1s/2s/4s backoff meant the row's trigger sat disabled and spinning
    // for about seven seconds before opening to the error state. One retry
    // still absorbs a transient blip and gets a genuine 404 on screen quickly.
    //
    // A missing `contentUrl` is different again: the nulls are already in the
    // entries the row is holding, so no request is even attempted and no amount
    // of retrying can change the outcome. Skipping the backoff there means the
    // panel opens to its explanation immediately.
    retry: (failureCount, error) =>
      failureCount < 1 && !(error instanceof MissingVersionContent),
    // Version content is immutable once written, so it never needs
    // revalidating and re-expanding a row should be instant.
    staleTime: Infinity,
    // Finite, unlike staleTime. Each entry is a pair of whole SKILL.md files,
    // and the version list is capped at 50, so a reader working through a long
    // history can accumulate a lot of them. `gcTime: Infinity` kept every one
    // resident for the entire session; 30 minutes keeps re-expanding instant
    // across any realistic visit while letting the rest fall out.
    gcTime: 30 * 60 * 1000,
  });
}
