"use client";

import { usePathname } from "next/navigation";
import { BundleBar } from "@/components/bundle-bar";

// The bar belongs on every browse/discovery surface — anywhere a user can find
// and add skills. Those include the dynamic source/skill routes (`/:org`,
// `/:org/:repo`, `/:org/:repo/:skill`, `/site/*`), which no exact-match list can
// enumerate. So the rule is inverted from the static surfaces: show on the known
// static browse routes, plus any path whose first segment isn't one of the
// reserved non-browse routes below. Only (main)-group routes ever reach this
// component (it's mounted from that layout), so the reserved set just needs the
// non-browse routes inside (main). The bar self-hides when the selection is
// empty, so an over-broad match is cosmetic only.
const STATIC_BROWSE_ROUTES = new Set(["/", "/compare", "/explore"]);
// Non-browse routes under (main). Everything else with an unreserved first
// segment is a source/skill/publisher discovery page (`/:org`, `/:org/:repo`,
// `/:org/:repo/:skill`, `/site/*`, `/official`).
const RESERVED_FIRST_SEGMENTS = new Set([
  "dashboard",
  "bundle",
  "settings",
  "pricing",
  "dev",
  "test",
]);

function isBrowseRoute(pathname: string): boolean {
  if (STATIC_BROWSE_ROUTES.has(pathname)) return true;
  const firstSegment = pathname.split("/")[1] ?? "";
  if (firstSegment === "") return true; // "/" — already covered, defensive
  return !RESERVED_FIRST_SEGMENTS.has(firstSegment);
}

/**
 * Mounts the bundle bar from the (main) layout so the same instance persists
 * across navigations between bundle surfaces — the expanded tray and other
 * local state survive e.g. home → repo → skill instead of remounting per page.
 * Navigating to a reserved (non-browse) route unmounts it (state resets).
 */
export function GlobalBundleBar() {
  const pathname = usePathname();
  if (!isBrowseRoute(pathname)) return null;
  return <BundleBar />;
}
