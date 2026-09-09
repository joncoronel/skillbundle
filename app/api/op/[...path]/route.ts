import { createRouteHandler } from "@openpanel/nextjs/server";

/**
 * Same-origin proxy for OpenPanel: the analytics endpoint and the SDK script.
 *
 * ── Why a proxy exists at all ─────────────────────────────────────────────
 *
 * Ad-blockers block requests to known analytics hosts. Routing them through our
 * own origin keeps the numbers honest.
 *
 * ── Why it is a route handler and NOT a `rewrites()` entry ────────────────
 *
 * It used to be two rewrites in `next.config.ts`, to `api.openpanel.dev` and
 * `openpanel.dev`. A Next rewrite to an absolute external URL forwards the
 * incoming request headers as-is. Verified against a local echo server, not
 * assumed: a request carrying `Cookie: __session=…; __client_uat=…` and
 * `Authorization: Bearer …` arrived at the destination with both intact.
 *
 * Because the proxy is same-origin, the browser attaches this site's cookies to
 * every beacon, and Clerk's `__session` is a bearer JWT. So the rewrite sent a
 * live session credential to a third-party analytics vendor on every tracked
 * event. A rewrite cannot strip a header, so the proxy has to run as code.
 *
 * ── Why the vendor's helper rather than a hand-rolled proxy ───────────────
 *
 * `createRouteHandler` builds a fresh `Headers` and sets only
 * `Content-Type`, `openpanel-client-id`, `origin`, `User-Agent` and
 * `openpanel-client-ip` (see `@openpanel/nextjs/dist/server.js`). That is an
 * ALLOWLIST. A hand-rolled version stripping `Cookie` and `Authorization` is a
 * denylist, and a denylist leaks whatever header nobody thought of. It also
 * caches the SDK script with an ETag and a day of `revalidate`, and it tracks
 * OpenPanel's own path conventions (`/track`, `/track/device-id`) as they
 * change.
 *
 * Note it deliberately forwards the caller's IP as `openpanel-client-ip`, taken
 * from `cf-connecting-ip` / `x-forwarded-for`. Without that the vendor would
 * see only our server, and geo would be wrong for every visitor. It is the one
 * identifying value that crosses, and it is the same value the vendor would
 * receive from a direct browser request.
 *
 * ── Why `/api/op/…` and not a catch-all directly under `/api` ─────────────
 *
 * The docs show `app/api/[...op]/route.ts`. That is a catch-all at the `/api`
 * root, which would sit alongside `/api/revalidate` and `/api/skills-token`.
 * Static segments win over catch-alls so those keep working, but the catch-all
 * would silently swallow every future mistyped `/api/*` path. Nesting it under
 * `/api/op` costs nothing: the handler locates `/track` inside the pathname and
 * matches the script on an `/op1.js` suffix, so both still resolve.
 *
 * `app/robots.ts` already disallows `/api/`, so this moved the analytics
 * endpoint behind that rule as a side effect. That is fine, and better than the
 * old root-level `/op/…` path, which nothing excluded.
 */
export const { GET, POST } = createRouteHandler();
