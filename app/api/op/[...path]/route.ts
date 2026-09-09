import { createRouteHandler } from "@openpanel/nextjs/server";

/**
 * Same-origin proxy for OpenPanel: the analytics endpoint and the SDK script.
 * It exists so ad-blockers do not eat the numbers.
 *
 * **Do not turn this back into a `rewrites()` entry.** It was two, and a Next
 * rewrite to an absolute external URL forwards the incoming headers as-is.
 * Verified against an echo server: `Cookie` and `Authorization` both arrived at
 * the destination. Same-origin means the browser attaches this site's cookies,
 * and Clerk's `__session` is a bearer JWT, so the rewrite shipped a live session
 * credential to the vendor on every event. A rewrite cannot strip a header.
 *
 * `createRouteHandler` forwards an allowlist: `Content-Type`,
 * `openpanel-client-id`, `origin`, `User-Agent`, `openpanel-client-ip` (see
 * `@openpanel/nextjs/dist/server.js`). A hand-rolled proxy stripping the two
 * known-bad headers is a denylist, which leaks whatever nobody thought of.
 * It does forward the caller's IP, deliberately: without it the vendor sees only
 * our server and geo is wrong for everyone.
 *
 * Nested at `/api/op` rather than the docs' `app/api/[...op]/route.ts`, which is
 * a catch-all at the `/api` root that would swallow every mistyped `/api/*`
 * path. The handler finds `/track` inside the pathname, so nesting costs
 * nothing.
 *
 * Its script branch (keyed on an `/op1.js` suffix) is deliberately unused: that
 * filename is on ad-blocker lists, so the script is served from the sibling
 * `s/route.ts` instead. See there.
 */
export const { GET, POST } = createRouteHandler();
