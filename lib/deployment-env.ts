/**
 * Is this build/render a PRODUCTION Vercel deployment?
 *
 * One predicate, two consumers that both degrade silently when it is wrong:
 *
 *   - `app/sitemap.ts` gates the full ~16-page catalog walk on it. False when it
 *     should be true means production ships a truncated sitemap — still
 *     well-formed XML, so nothing downstream notices.
 *   - `lib/site-url.ts` gates its https-origin build guard on it. False when it
 *     should be true means the guard goes quiet and robots.txt plus every
 *     `<loc>` can ship pointing at localhost.
 *
 * They share a blind spot, which is the reason this is one exported constant
 * rather than the same comparison written twice: `VERCEL_ENV` is a Vercel SYSTEM
 * environment variable, and the project setting that exposes system variables to
 * builds can be turned off. Flip that setting and BOTH protections disappear at
 * once, with no error and no diff. `app/sitemap.ts` logs the branch it took at
 * generation time, which is the only trace either failure leaves.
 *
 * `server-only` for the same correctness reason `lib/site-url.ts` carries it:
 * only `NEXT_PUBLIC_`-prefixed variables are inlined into the client bundle, so
 * in a Client Component this would read `undefined` and resolve to `false`
 * — the same import meaning different things depending on where it lands.
 *
 * Note this resolves per RENDER, not once per deployment. It is read at build
 * time during prerender and re-read at runtime during revalidation, and the two
 * can disagree: a deployment built as a preview and later promoted to production
 * prerenders with `false` and then revalidates with `true`. `app/sitemap.ts`
 * documents what that means for the artifact it bakes.
 */
import "server-only";

export const IS_PRODUCTION_DEPLOYMENT = process.env.VERCEL_ENV === "production";
