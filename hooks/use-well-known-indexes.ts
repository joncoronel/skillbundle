"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { isGitHubSource } from "@/lib/skill-urls";
import type { WellKnownIndexes } from "@/lib/install-commands";

// Stable identity so a caller that memoizes on the result doesn't re-run on
// every render while the query is in flight.
const EMPTY: WellKnownIndexes = {};

/**
 * The well-known index map for whatever skills a client island is holding, for
 * `buildSkillInstallCommand` and friends. Server pages use
 * `lib/well-known-index.ts` instead; this is the websocket half.
 *
 * Skips the query entirely when the set contains no well-known source, which is
 * the overwhelmingly common case (~98% of the catalog is GitHub) — a bundle of
 * GitHub skills costs nothing. Returns an empty map while the query is in
 * flight, so a well-known command appears when its answer lands rather than
 * being guessed at and corrected.
 */
export function useWellKnownIndexes(
  skills: readonly { source: string }[],
): WellKnownIndexes {
  const sources = useMemo(() => {
    const distinct = new Set<string>();
    for (const skill of skills) {
      if (!isGitHubSource(skill.source)) distinct.add(skill.source);
    }
    // Sorted so an unchanged set produces identical query args across renders.
    return [...distinct].sort();
  }, [skills]);

  const indexes = useQuery(
    api.wellKnown.wellKnownSkillNames,
    sources.length > 0 ? { sources } : "skip",
  );

  return indexes ?? EMPTY;
}
