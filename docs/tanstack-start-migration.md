# Migrating to TanStack Start on Cloudflare: research notes

Researched 2026-10-14, the day after TanStack Start 1.0 went stable. **Decision:
not now.** This file is a starting point if the question comes back, not a plan.
Every claim about TanStack Start or Cloudflare below was true on that date and
should be re-checked before acting on it. Both were moving fast.

## Why it was parked

- **The money is small.** Cloudflare Workers Paid is $5/mo and includes 10M
  requests; we serve about 2M a month. Expected cost about $5-8/mo against
  Vercel's ~$20-30/mo after the Oct 2026 bot fixes, so roughly $200-300 a year.
- **The work is large.** Several weeks: every route, the whole caching layer,
  auth wiring, OG images, and the e2e suite that guards instant navigation (see
  "Porting inventory").
- **The risky part was the unsettled part.** Caching SSR pages on Cloudflare,
  which is the only thing that makes a 16k-page catalog cheap, was documented
  wrongly by TanStack at the time (see "Caching on Cloudflare").

Revisit if any of these is true: the Vercel bill stays above ~$30/mo; TanStack's
Cloudflare caching guidance has been corrected and used in production by others;
or there is a reason to leave Vercel other than cost.

## Framework status (Oct 2026)

- **1.0 is stable** (2026-10-13), described by the maintainers as "a formal
  commitment to the APIs we've built". The release candidate was out from Sep 2025.
- **Deployment goes through Vite plus Nitro**, rather than adapters Start
  maintains itself. Cloudflare Workers has a project generator and Vite
  integration, built by a Cloudflare partner.
- **React Server Components are experimental and opt-in.** The docs say they
  "will remain so into early v1". The API is `renderServerComponent` and
  `createCompositeComponent` from `@tanstack/react-start/rsc`. Composite
  Components work the other way round from Next: the server leaves slots and the
  client fills them. In the 1.0 post the maintainer said he stopped using RSC on
  tanstack.com because it was hard to reason about what ships where.
  **Recommendation: don't use them.** Loaders, server functions and Convex React
  Query cover everything we do with server components now.
  - Known limits if they're ever used: slot children are opaque on the server
    (`Children.map` and `cloneElement` don't work); render-prop arguments must be
    serialisable; Start's own serialisation isn't available inside them; when
    caching them in React Query, set `structuralSharing: false`.
- **Selective SSR** lets each route render fully on the server, load data on the
  server but render on the client, or be client-only.
- **No built-in image, font or metadata tools.** Start's own comparison page
  lists replacing `next/image`, `next/font` and the metadata conventions as
  migration work.

## What would happen to UX

### Client navigation: can match today

- TanStack Router preloads route code and loader data on hover or intent
  (`defaultPreload: 'intent'`).
- `pendingComponent` gives an immediate skeleton, but **`pendingMs` defaults to
  1000ms**, which must be set to 0 to get today's instant-skeleton feel.
- Data already comes from Convex through React Query, which fits Start well.
  Convex has an official TanStack Start integration (SSR in the loader through
  `ensureQueryData`, then the websocket keeps it live).
- **What's lost:** Next's Partial Prefetching hands out one reusable App Shell
  per route, with the `'use cache'` data already baked in. Start has no
  equivalent, so the feel has to be rebuilt per route with loaders and pending
  components, and nothing enforces it unless new tests are written.

### Hard loads (first visit, e.g. from Google): depends on caching

- Today every route has a prerendered static shell on the CDN, and the dynamic
  parts stream in (PPR). **Start has no partial prerendering**, so you cache
  whole pages or nothing.
- Whole-page caching suits this app, because all per-user data already loads on
  the client over the Convex websocket. Skill pages are the same for everyone.
- But skill pages had only a **~5% cache hit rate** (measured Aug 2026), because
  traffic is thin across ~16k URLs. So most real visitors would hit a miss and
  get a Worker SSR render. It feels fast only if loaders defer data so the
  skeleton streams first. If a loader awaits Convex before streaming, the visitor
  sees nothing until the query returns.
- `bundle/[id]` is the one page that reads request-time data (`io()`), so it
  would just be uncached SSR.

## Caching on Cloudflare (the crux)

- **TanStack's ISR guide was wrong for Cloudflare at the time.** It says to set
  `Cache-Control` headers and let the CDN cache the page. On Cloudflare, Workers
  run _in front of_ the CDN, so those headers alone cache nothing. See TanStack
  issue #7527 (opened 2026-06-02, still open), and PR #8518, which corrects the
  guidance. Check whether that PR merged and what the guide says now.
- **What does work: Workers Cache** (launched 2026-07-06). Turn it on with
  `"cache": { "enabled": true }` in the Wrangler config. It's a regionally
  tiered cache in front of the Worker, controlled by standard `Cache-Control`
  headers.
  - It only stores responses whose `Cache-Control` includes `public`,
    `must-revalidate` or `s-maxage`. `private`, `no-store`, a `Set-Cookie`
    header or `Vary: *` bypass it. Only GET and HEAD are cached.
  - **Gotcha:** `s-maxage` turns off stale-while-revalidate. For SWR on HTML,
    use `public, max-age=..., stale-while-revalidate=...` without `s-maxage`.
    TanStack's guide and third-party guides show `s-maxage` together with SWR,
    which doesn't serve stale on Workers.
  - **Purging:** set a `Cache-Tag` response header and call
    `ctx.cache.purge({ tags: [...] })`. Also supports purging by path prefix and
    purging everything. Purges are scoped to the Worker entrypoint, not the zone.
  - Zone Cache Rules have no effect on a Worker's responses.
  - Billing: a hit costs one Workers request ($0.30 per million after the
    included 10M) and no CPU time. There's no per-write fee like Vercel's ISR
    writes, so crawler traffic would cost close to nothing. That's the real
    structural advantage of the move.
- Workarounds people used before Workers Cache (from #7527): page HTML in KV with
  tag invalidation, KV-cached query results, or Cloudflare Snippets on a Pro
  zone. Workers Cache should make these unnecessary; confirm.
- **Mapping our invalidation:** Convex's `revalidateSiteTag` pings would become
  `Cache-Tag` purges. Tags today are `home-popular`, `skill-sync` and
  `skill-content` (`lib/cache-tags.ts`, `convex/lib/revalidate.ts`). The model
  carries over.
- **What has no equivalent:** the 22 `'use cache'` files cache _data and
  components_ across requests (`lib/skill-cache.ts`, `source-skills.ts`,
  `well-known-index.ts`, `category-*`, `search/typesense.ts`, `og/images.tsx`,
  sitemap, the skill-history components). Whole-page caching covers most of it.
  The rest would need KV or the Cache API, or reliance on Convex's own query
  cache. Note that the Cache API is per data centre and doesn't use tiered caching.

## Porting inventory (Oct 2026 snapshot)

Re-run this before starting; the counts will have drifted.

- **next.config.ts:** `cacheComponents`, `partialPrefetching`,
  `experimental.instantInsights`, `serverExternalPackages: ["@vercel/oidc"]`,
  `outputFileTracingIncludes` for the `assets/og/**` fonts, a Turbopack shiki
  theme alias, security headers (HSTS, nosniff, Referrer-Policy,
  Permissions-Policy), and the `withBotId()` wrapper.
- **Routes:** 33 `page.tsx`. `generateStaticParams` on `[org]`,
  `[org]/[repo]`, `site/[source]`, `skills/[category]` and both `[skillId]`
  layouts. `generateMetadata` on about 15 routes. 11 `loading.tsx` files, 4
  error and not-found files, plus `sitemap.ts`, `robots.ts` and `manifest.ts`.
- **OG images:** 9 `opengraph-image.tsx` files, plus the versioned bundle OG
  route `bundle/[id]/og/[v]`, all using `next/og` `ImageResponse`. On Workers
  this means satori plus resvg WebAssembly, and ~16k skill OG images rendering
  on Worker CPU. Check CPU limits and cache them.
- **Route handlers:** `api/revalidate`, `api/skills-token`, `api/op/[...path]`
  (OpenPanel proxy) and `api/op/s` (the SDK script, using
  `next: { revalidate }`).
- **Server actions** become Start server functions: `analyzeRepoSignedOut`
  (`app/(main)/actions.ts`, which uses `headers()` and BotID), and
  `getSessions` and `revokeSession` (`app/(main)/settings/actions.ts`, Clerk).
- **Navigation APIs:** `next/link` in 46 files; `useRouter` 20 hits,
  `usePathname` 12, `useSearchParams` 9, `notFound` 20, `redirect` 1;
  `useSelectedLayoutSegment` (`components/skill-tabs.tsx`), `useLinkStatus`
  (`components/link-pending.tsx`), `next/dynamic` (`skill-detail-sheet.tsx`) and
  `catchError` (`components/data-error-boundary.tsx`).
- **Fonts:** `next/font/google` (Google Sans Code) and `next/font/local` (Open
  Runde) in `app/layout.tsx`.
- **Convex server reads:** `convex/nextjs` in 12 files (`fetchQuery`,
  `preloadQuery` + `usePreloadedQuery` for bundles, `fetchAction`).
- **Clerk:** `@clerk/nextjs` in 25 files, with `clerkMiddleware` in `proxy.ts`.
  This becomes `@clerk/tanstack-react-start` and Start middleware. Auth uses
  custom forms (`useSignIn`/`useSignUp`), not prebuilt components, so the swap
  is mostly imports. Keep the inverted private-route list logic (see
  docs/architecture.md §3).
- **URL state:** nuqs uses `nuqs/adapters/next/app`; switch to its TanStack
  Router adapter.
- **Analytics:** `@openpanel/nextjs`, including `createRouteHandler`.
- **Theme:** `next-themes`.
- **Tests:** `e2e/instant-navigation.spec.ts` and two authenticated specs use
  `instant()` from `@next/playwright`, which won't exist. The UX guarantees
  they protect (docs/architecture.md §1, §2, §14, §15) would need new tests.
  Vitest suites tied to Next: `proxy-matcher`, `revalidate-route`,
  `skills-token-route`, `sitemap-*`, `seo`.
- **Docs:** most of docs/architecture.md describes Next-specific rendering.

## Things that only work on Vercel

- **`/api/skills-token`** mints a Vercel OIDC token (`getVercelOidcToken()`)
  that Convex relays to skills.sh, whose documented auth is a Vercel OIDC token.
  Off Vercel this path is gone. The code falls back to the legacy skills.sh key
  (see TODO.md "skills.sh API auth"). Before migrating, either confirm the key
  is still accepted long term, ask skills.sh about another auth method, or keep
  a tiny Vercel function only for minting tokens (check the plan's terms first).
- **BotID** protects the signed-out repo analysis (`instrumentation-client.ts`,
  `checkBotId` in `actions.ts`). Cloudflare Turnstile is the obvious
  replacement.
- **`vercel.json` + `scripts/vercel-ignore-build.mjs`** skip builds for
  markdown-only changes. Cloudflare's build or CI would need the same rule.
  Cache resets on deploy are less of a cost on Cloudflare since there are no
  write fees, but cold misses still cost Convex reads.
- **The Vercel Firewall setup from Oct 2026:** Bot Protection in challenge mode,
  the residential-scraper rule, the Meta AI crawler block, and the
  robots.txt/sitemap bypass. Recreate it in Cloudflare WAF and Bot Management.

## How to start, if it comes back

1. Re-check everything under "Framework status" and "Caching on Cloudflare",
   especially TanStack issue #7527 / PR #8518 and the Workers Cache docs.
2. Do what Start's own comparison page recommends: port **one representative
   route** first. Use the skill Overview (`/[org]/[repo]/[skillId]`), because it
   carries the most traffic and the hardest caching case.
3. On that spike, measure: hard-load time on a cache miss and on a hit; whether
   the skeleton streams before Convex returns; client navigation with hover
   preload; the Workers Cache hit rate under real crawler traffic; tag purges
   from a Convex ping; and OG image CPU time.
4. Only commit to the full migration if the spike matches today's UX on both
   hard loads and client navigation.

## Sources

- [TanStack Start 1.0 is Stable](https://tanstack.com/blog/tanstack-start-1-0)
- [TanStack Start vs Next.js](https://tanstack.com/start/latest/docs/framework/react/start-vs-nextjs)
- [Server Components guide](https://tanstack.com/start/latest/docs/framework/react/guide/server-components)
- [ISR guide](https://tanstack.com/start/latest/docs/framework/react/guide/isr)
- [TanStack issue #7527: ISR can't work on Cloudflare as documented](https://github.com/TanStack/router/issues/7527)
- [TanStack PR #8518: correct the ISR cache deployment guidance](https://github.com/TanStack/router/pull/8518)
- [Cloudflare blog: Workers Cache](https://blog.cloudflare.com/workers-cache/)
- [Cloudflare docs: Workers Cache configuration](https://developers.cloudflare.com/workers/cache/configuration/)
- [Cloudflare docs: Workers Cache limitations](https://developers.cloudflare.com/workers/cache/limitations/)
