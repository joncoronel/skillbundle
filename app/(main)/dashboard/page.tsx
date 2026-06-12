import { DashboardContent } from "./dashboard-content";
import { DashboardMasthead } from "./dashboard-masthead";

// The page is static — auth is enforced by the middleware (proxy.ts), and the
// per-user data is client-fetched over the already-authenticated Convex
// websocket (see DashboardContent). Same treatment as /settings: the shell
// contains no user data, so it prefetches and paints instantly on nav, and
// visits don't consume Vercel function invocations. The trade-off is cold
// direct loads (bookmarks) showing the skeleton until the client Convex
// handshake completes, where the old dynamic version streamed data in the
// HTML — in-app navigation dominates for a top-nav destination.

export default function DashboardPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 pt-12 pb-20">
      <div className="space-y-10">
        <DashboardMasthead />
        <DashboardContent />
      </div>
    </main>
  );
}
