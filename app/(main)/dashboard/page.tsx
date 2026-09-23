import { DashboardContent } from "./dashboard-content";
import { DashboardMasthead } from "./dashboard-masthead";

// The page is static and public. DashboardContent switches on client auth:
// signed in, the account's bundles over the authenticated Convex websocket;
// signed out, the bundles saved in this browser (lib/local-bundles.ts). The
// shell contains no user data, so it prefetches and paints instantly on nav,
// and visits don't consume Vercel function invocations. The trade-off is cold
// direct loads (bookmarks) showing the skeleton until the client Convex
// handshake completes, where the old dynamic version streamed data in the
// HTML — in-app navigation dominates for a top-nav destination.

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-12 pb-20">
      <div className="space-y-10">
        <DashboardMasthead />
        <DashboardContent />
      </div>
    </div>
  );
}
