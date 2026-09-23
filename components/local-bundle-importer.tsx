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
 * Moves bundles saved in this browser into the account, once, the first time
 * this page load sees a signed-in user. Mounted in the (main) layout so it runs
 * wherever sign-in lands. Renders nothing.
 *
 * Inside a Web Lock, reading storage directly rather than the atom: two tabs
 * that finish signing in together would otherwise both send the same bundles.
 * The second tab gets the lock after the first has removed what it moved, and
 * finds nothing left to send.
 *
 * Whatever the server skipped (it would have taken the account past a limit)
 * stays in the browser, and the dashboard lists it under "Still in this
 * browser" once this has settled.
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

      // Bundles over the limit stay behind and are sent again on every load,
      // since an upgrade is what lets them in. Say so once per set rather than
      // every visit: the dashboard already lists them under "Still in this
      // browser".
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

      // Standing on the local page of a bundle that just moved: follow it to
      // its account page rather than leaving a "not in this browser" state.
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
        // Nothing was removed, so the bundles are all still in the browser and
        // the next page load tries again.
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
