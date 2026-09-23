"use client";

import { useEffect, useRef } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { useSetAtom } from "jotai";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { toast } from "@/components/ui/cubby-ui/toast/toast";
import { useHydrated } from "@/hooks/use-hydrated";
import {
  importSettledAtom,
  LOCAL_BUNDLES_KEY,
  useLocalBundleActions,
  type LocalBundle,
} from "@/lib/local-bundles";

/** The set of left-behind bundles the last toast was about. */
const SKIPPED_KEY = "skillbundle:import-skipped";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Moves bundles saved in this browser into the account on the first signed-in
 * render of a page load. Inside a Web Lock, reading storage directly, so two
 * tabs signing in together can't both send them. Skipped bundles stay behind
 * and the dashboard lists them.
 */
export function LocalBundleImporter() {
  const { isAuthenticated } = useConvexAuth();
  const hydrated = useHydrated();
  const importBundles = useMutation(api.bundles.importLocalBundles);
  const { removeMany } = useLocalBundleActions();
  const setSettled = useSetAtom(importSettledAtom);
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (!hydrated || !isAuthenticated || started.current) return;
    started.current = true;

    async function run() {
      const raw = localStorage.getItem(LOCAL_BUNDLES_KEY);
      const bundles = raw ? (JSON.parse(raw) as LocalBundle[]) : [];
      if (bundles.length === 0) return;

      const { imported, skipped } = await importBundles({
        bundles: bundles.map((b) => ({
          localId: b.id,
          name: b.name,
          description: b.description,
          skills: b.skills.map(({ source, skillId, addedAt }) => ({
            source,
            skillId,
            addedAt,
          })),
          createdAt: b.createdAt,
          lastViewedAt: b.lastViewedAt,
        })),
      });
      removeMany(imported.map((i) => bundles[i.index].id));

      // Left-behind bundles are retried every load; toast once per set.
      const skippedSet = skipped
        .map((i) => bundles[i].id)
        .sort()
        .join(",");
      const toldAbout = localStorage.getItem(SKIPPED_KEY);
      if (skippedSet) localStorage.setItem(SKIPPED_KEY, skippedSet);
      else localStorage.removeItem(SKIPPED_KEY);

      if (imported.length > 0) {
        toast({
          title: `Moved ${plural(imported.length, "bundle")} to your account`,
          description:
            skipped.length > 0
              ? `${plural(skipped.length, "bundle")} stayed in this browser because ${skipped.length === 1 ? "it" : "they"} would take you past your plan's limit.`
              : undefined,
        });
      } else if (skippedSet && skippedSet !== toldAbout) {
        toast({
          title: `${plural(skipped.length, "bundle")} stayed in this browser`,
          description:
            "Moving them would take you past your plan's watched-skill limit.",
        });
      }

      // Follow a bundle that just moved from its local page to its new one.
      const here = new URL(window.location.href);
      if (here.pathname === "/bundle/local") {
        const id = here.searchParams.get("id");
        const moved = imported.find((i) => bundles[i.index].id === id);
        if (moved) router.replace(`/bundle/${moved.urlId}`);
      }
    }

    navigator.locks
      .request("skillbundle:import-local-bundles", run)
      .catch((error: unknown) => {
        // Nothing was removed, so the next page load tries again.
        console.error("Couldn't move browser bundles to the account", error);
        toast.error({
          title: "Couldn't move your saved bundles",
          description:
            "They're still in this browser. We'll try again next time you visit.",
        });
      })
      .finally(() => setSettled(true));
  }, [
    hydrated,
    isAuthenticated,
    importBundles,
    removeMany,
    setSettled,
    router,
  ]);

  return null;
}
