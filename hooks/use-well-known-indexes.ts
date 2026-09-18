"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
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
 * Through TanStack Query rather than `convex/react`'s `useQuery`, which throws
 * on a failed query. One of the callers is the floating bundle bar, which lives
 * in the `(main)` layout: a throw there would take every route to the error
 * screen over a missing install command. Here a failure is a value, and the
 * empty map it falls back to means "no command", which is the safe reading.
 *
 * Disabled entirely when the set holds no well-known source, the overwhelmingly
 * common case (~98% of the catalog is GitHub): a bundle of GitHub skills costs
 * nothing and reports `pending: false` immediately.
 *
 * `pending` exists because an in-flight query and a domain with no index are
 * both an empty map, and callers that state the second out loud would otherwise
 * assert it during the first. Hold any such claim until `pending` clears.
 */
export function useWellKnownIndexes(skills: readonly { source: string }[]): {
  indexes: WellKnownIndexes;
  pending: boolean;
} {
  const sources = useMemo(() => {
    const distinct = new Set<string>();
    for (const skill of skills) {
      if (!isGitHubSource(skill.source)) distinct.add(skill.source);
    }
    // Sorted so an unchanged set produces identical query args across renders.
    return [...distinct].sort();
  }, [skills]);

  const enabled = sources.length > 0;
  const { data, isPending } = useQuery({
    ...convexQuery(api.wellKnown.wellKnownSkillNames, { sources }),
    enabled,
  });

  return {
    indexes: data ?? EMPTY,
    pending: enabled && isPending,
  };
}
