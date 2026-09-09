/**
 * Serves the OpenPanel browser SDK from a path ad-blockers do not match.
 *
 * The sibling `[...path]` handler can serve this too: `createRouteHandler` has a
 * script branch keyed on a `/op1.js` suffix. That suffix is the problem.
 * Blocklists match URL patterns, not just hostnames, and `op1.js` is
 * OpenPanel's well-known filename, so `/api/op/op1.js` was blocked in a normal
 * browser with an extension even though the host is ours. Confirmed from a
 * DevTools capture: request cancelled, "provisional headers shown", no `track`
 * calls afterwards at all, because a blocked script means `window.op` never
 * exists and every later `track()` is a silent no-op.
 *
 * A static segment beats the catch-all, so this route wins for `/api/op/s` and
 * `[...path]` keeps the beacon.
 *
 * Forwards no headers from the caller. The path is same-origin, so the browser
 * attaches this site's cookies to it, and a plain script fetch has no business
 * carrying a Clerk session JWT to a vendor. Same reason the beacon uses the
 * vendor's header allowlist.
 *
 * Cached hard: the SDK is a pinned vendor file, so the CDN should absorb this
 * rather than invoking a function per page load.
 */

const UPSTREAM = "https://openpanel.dev/op1.js";

export async function GET() {
  const upstream = await fetch(UPSTREAM, { next: { revalidate: 86400 } });

  if (!upstream.ok) {
    // Fail quiet. Analytics is not worth breaking a page over, and an error
    // body served as JavaScript is a console parse error on every load.
    return new Response("", {
      status: 204,
      headers: { "Cache-Control": "public, max-age=60" },
    });
  }

  return new Response(await upstream.text(), {
    status: 200,
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=86400",
    },
  });
}
