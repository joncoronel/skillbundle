# Next.js 16 + Convex + Clerk Architecture Guide

Patterns used in this app: Next.js 16 (App Router) on Vercel, Convex as the backend/database, Clerk for authentication.

## Stack

| Layer | Tech | Role |
| --- | --- | --- |
| Frontend | Next.js 16.3 (App Router), React 19 | Cache Components: static shells + server-streamed dynamic holes, Partial Prefetching |
| Backend + DB | Convex | Real-time queries, mutations, actions, storage |
| Auth | Clerk (Core 3) + `convex/react-clerk` | Auth via Clerk, bridged to Convex via JWT |
| Billing | Polar + `@convex-dev/polar` | Subscription billing via Polar MoR, synced to Convex |
| Data Layer | TanStack Query + `@convex-dev/react-query` | Client-side query integration |
| URL State | nuqs | Type-safe URL search param state management |

### Key dependencies

```text
@clerk/nextjs        # Core 3
@clerk/backend       # Core 3
convex
convex/react-clerk
@convex-dev/react-query
@convex-dev/polar
@tanstack/react-query
nuqs
svix
```

> **History note:** the app is built on **Cache Components** (`cacheComponents: true`) plus **Partial Prefetching** (`partialPrefetching: true`), enabled in `next.config.ts`. An earlier attempt at `cacheComponents` was reverted because, under the old model, runtime-discovered dynamic params (`/[org]/...`) couldn't be cached or prefetched and a root-layout `<Suspense>` blanked every route's HTML. **Next.js 16.3 resolves both:** `dynamicParams` now serves a reusable [App Shell](https://nextjs.org/docs/app/glossary#app-shell) instantly for unknown params (each catalog route's `generateStaticParams` returns one representative value so the shell can be prerendered — see `lib/representative-params.ts`), and the empty-document problem is avoided simply by keeping `app/layout.tsx` free of a root `<Suspense>`. So the re-adoption is deliberate and current; the old "we removed cacheComponents" note no longer applies.

---

## 1. Rendering & Caching Strategy

### Guiding principles

1. **Prerenderable-first (Cache Components).** Every route prerenders a static shell; request-time or uncached work streams into `<Suspense>` / `loading.tsx` fallbacks (`◐`), and cached work (`'use cache'`) lands in the shell. A route is fully static (`○`) when nothing streams. Shells are CDN-served and, under Partial Prefetching, `<Link>` prefetches a single reusable App Shell per route (shared across links), so navigation paints instantly before data arrives.
2. **Per-user data is fetched on the client over the Convex websocket**, never baked into pages. The static shell contains zero user data; auth-gated routes are protected by middleware.
3. **Push load toward Convex, not Vercel functions.** The app runs on Vercel Hobby (fixed allotments, no overage) and Convex Pro (25M calls/month + paid overage, plus Convex's own query cache). When choosing where work runs, the platform with headroom wins. This is why client→Convex direct queries are preferred over route handlers / server-side fetching wherever the data is per-user or interactive.

### Route inventory

| Route | Type | Data strategy |
| ----- | ---- | ------------- |
| `/` (home) | `○` Static (1h cacheLife) | Leaderboards server-cached via `'use cache'` + `cacheTag`, revalidated on-demand by Convex crons; search is client-side. Popular list renders its first page statically for SSR, then activates infinite scroll on the client |
| `/compare` | `○` Static | Skills in `?skills=` param (nuqs), one client Convex query per column |
| `/settings` | `○` Static | Clerk hooks client-side; sessions via server action, fetched on demand |
| `/dashboard` | `○` Static | `listByUser` + `currentPlan` client-fetched over the authed websocket |
| `/add` | `○` Static | Public add-skill flow; auth resolves client-side (`useConvexAuth`), quota via `myGitHubAddQuota` over the websocket, adds via Convex actions |
| `/official`, `/pricing` | `○` Static | official: `'use cache'` curated owners loader, `cacheTag('skill-sync')`. Its `cacheLife("days")` means the publisher list is cached content with `stale ≥ 5min`, so the **whole list is in the App Shell**, not just the header |
| `/[org]`, `/[org]/[repo]`, `/[org]/[repo]/[skillId]`, `/site/...` | `◐` Partial Prerender | `generateStaticParams` returns one representative param (App Shell prerenders); unknown params get the shell instantly — from the page's own Suspense fallbacks on the listing routes, from `loading.tsx` on the skill routes (see "pick one, not both" below) — then upgrade. Data via `'use cache'` loaders split across three tags — `cacheTag('skill-sync')` for install/version data, `cacheTag('skill-content')` for the skill row, `cacheTag('skill-audit')` for the audit list (`lib/skill-cache.ts`). **These pages must not `await params` above their Suspense boundaries** — see "Params and the shared App Shell" below |
| `/bundle/[id]`, `/dev`, `/dev/add-skill` | `◐` Partial Prerender | bundle: `loading.tsx` shell + `preloadQuery` authed content streams in, with `await io()` declaring the request-time boundary; dev: `verifyAdmin()` streams behind a Suspense gate |
| `/opengraph-image` plus the compare / official / pricing OG images | `○` Static | Param-free OG routes prerender. (Only the *param-dependent* OG routes are `ƒ`.) |
| `/[org]/**/opengraph-image`, `/site/**/opengraph-image`, `/bundle/[id]/og/[v]`, `/api/revalidate`, `/api/skills-token` | `ƒ` Dynamic | OG images (data via `'use cache'`, rendered PNG CDN-cached via `Cache-Control`); revalidate webhook (secret-gated, called by Convex crons); skills-token relay (secret-gated, POST-only, mints a Vercel OIDC token for the Convex sync — see below) |

**The two secret-gated API routes.** `/api/revalidate` and `/api/skills-token`
are the app's only unauthenticated write/credential surfaces. Both sit outside
Clerk's private-route list on purpose (see §3), so a shared secret in a request
header is the entire gate, compared with `timingSafeEqual` via
`lib/shared-secret.ts` and failing closed when the secret is unset on the
deployment. Convex calls both.

`/api/skills-token` exists because skills.sh's documented credential is a Vercel
OIDC token, which only a Vercel runtime can mint, while our whole sync runs on
Convex crons. Convex POSTs here hourly, caches the token, and sends it upstream
itself; the legacy `SKILLS_SH_API_KEY` stays wired as the fallback. Requires
`SKILLS_TOKEN_SECRET` on Vercel plus `SKILLS_TOKEN_URL` / `SKILLS_TOKEN_SECRET`
on the production Convex deployment. `/dev` shows which credential is live. The
full rationale, including why proxying every upstream call through Vercel was
rejected, is in TODO.md.

### Params and the shared App Shell

Under Partial Prefetching, Next builds **one App Shell per route** and reuses it
for every link to that route, so the shell is rendered with **no URL data**. A
page that does `const { org } = await params` at its top level puts everything
below that await — including its own `<Suspense>` fallbacks — behind an unknown
value, so the shared shell comes out empty and every *client navigation* into
the route blocks.

Direct page loads look fine either way, because there the URL is known. That
asymmetry is why this regressed silently once and is now guarded by
`e2e/instant-navigation.spec.ts`, which asserts the client-navigation case
specifically.

The rule for `/[org]`, `/[org]/[repo]` and `/site/[source]`: the page component
is **synchronous** and passes the `params` promise down into Suspense-wrapped
children. URL-derived chrome (breadcrumb tail, `h1`) gets its own boundary with
a shape-matching skeleton; the listing gets another. What lands in the shared
shell is the page frame, both skeletons, and the list's column headers.

### `loading.tsx` or an in-page shell — pick one, not both

A route gets its instant shell from exactly one of two places, and which one
depends on how much of the page is params-independent:

- **Mostly params-independent → in-page `<Suspense>`, no `loading.tsx`.** The
  listing routes have real structure that doesn't depend on the URL (the page
  frame, the meta row, the "Source / Installs" column headers), so the page
  renders its own shell and it is strictly more faithful than a generic one.
- **Almost everything is params-dependent → `loading.tsx` IS the shell.** On the
  skill detail routes the breadcrumb and the `h1` are both URL data, so there is
  nothing worth rendering above a boundary. Those pages keep `await params` at
  the top and let `loading.tsx` cover the whole route. That is the correct shape
  for them, not an oversight.

**Having both is the failure mode.** The listing routes briefly did: their
`loading.tsx` painted an all-skeleton page, then the page's own shell replaced it
with a differently-shaped one (skeleton column headers vs. real text, `h-12`
title vs. a `clamp()` line box), then the content arrived. Three phases and two
distinct skeletons on one load. `ListingPageLoading` and those three
`loading.tsx` files were deleted once the pages grew their own shells.

If you add the params-into-Suspense split to a route, delete its `loading.tsx`
in the same change. If you keep `loading.tsx`, don't also add page-level
fallbacks above the data boundary.

### Never read the clock in server-rendered output

`Date.now()` (and `new Date()`, `Math.random()`) during a prerender is unstable
IO. Under Cache Components the surrounding subtree stops being prerenderable —
and if it sits inside a `<Suspense>`, **nothing errors and the build stays
green**. The boundary just becomes a permanent dynamic hole: only the static
shell is persisted, so every cached hit serves the fallback and re-renders the
content on the client. The route still says `◐` in the build output and direct
loads still look correct, which is what makes this so easy to miss.

This shipped once. Moving the History section to a Server Component pulled
`timeAgo` (which reads `Date.now()`) into skill detail's prerender for the first
time. Measured on preview deployments differing by that one call: the cached
HTML went from 366 KB with the body to 231 KB without it, and the skeleton
became visible on every reload. `lib/utils.ts` now carries the warning on
`timeAgo` itself.

The symptom to watch for: a cached `x-vercel-cache: HIT` that is materially
smaller than the on-demand `PRERENDER` of the same URL. Compare the two and look
for content that is present in one and absent in the other.

Use `formatDate` for anything that can land in a *prerenderable* route's output.
If such a surface genuinely needs relative time, swap to it on the client after
hydration — it cannot come from the server.

The qualifier matters, because the remaining `timeAgo` callers are safe for
three different reasons and it's worth knowing which one you're relying on
before you move code between them:

- **`/bundle/[id]` server-renders relative times on purpose.** The register's
  `addedAt` column and its change lines both reach server HTML, because their
  data is preloaded rather than fetched on the client. That is fine here and
  only here: the route reads auth and calls `io()`, so it is request-time with
  no shared shell to poison, and those change times are the monitoring answer
  the page exists to give. The residual cost is a possible hydration text patch
  when the clock crosses a bucket between render and hydration.
- **The dashboard's callers never reach server output at all** — `bundle-card`
  and the change feed are fed by a client `useQuery`, and `dashboard-content`
  renders a skeleton while it is `undefined`. That gate was written for the
  Clerk-to-Convex handshake, not for prerender safety, so it is load-bearing by
  accident; don't remove it without checking this.
- **`/dev` never prerenders**, because it sits behind an admin check inside
  `<Suspense>`.

Adding a clock read to a route that *is* prerenderable re-opens the hazard.

### Why each type

**Static + client data (most routes).** The whole page shell — including a meaningful default state, see §8 — prerenders at build. Navigation between these routes is instant (full prefetch). Per-user or interactive data arrives via the client Convex connection, which the root provider keeps open and authenticated across the whole session, so in-app navigations pay no handshake.

**A note on deferring sections to the client.** The History section on skill
detail used to fetch its own data: deferred behind an IntersectionObserver, then
a Convex `useQuery` subscription. The motivation was sound — don't open a live
subscription on the app's highest-traffic route for a region most readers never
scroll to — but the fix was aimed at the wrong layer. It produced a second
loading phase after the page had already rendered, and layout shift as the
section went from an empty placeholder, to a spinner, to a full list.

The version rows now sit in the page's existing `Promise.all` behind `'use cache'`
with `cacheTag("skill-sync")` (folded into `loadSkillSyncData` alongside insights
and copies), and `SkillHistory` is a Server Component taking
the rows as a prop. That removes the subscription entirely rather than deferring
it, collapses three render phases into one, and puts the timeline in the cached
HTML, so it costs one Convex call per cache period instead of one per reader.

The general rule this illustrates: **on a cacheable server-rendered route, the
answer to "this section is expensive on the client" is usually to move it to the
server, not to defer it.** Deferring keeps the cost and adds a loading state.
What legitimately stays lazy is genuinely per-interaction work — the diff
renderer in `skill-history-row.tsx` pulls the full shiki bundle and only matters
once a row is expanded.

**Partial Prerender for the catalog routes.** Skill/org/repo pages are public, high-cardinality, and shared. `generateStaticParams` returns one representative param (`lib/representative-params.ts` picks the most popular skill of each source type at build — memoized at module scope so the scan runs once, not once per route — with a known-good fallback) so Next can prerender the route's App Shell. It only needs one real path because an unknown or even invalid param still extracts a working shell; the representative just gives Next one concrete page to fully prebuild. `dynamicParams: true` is the default: a visitor to an unknown path gets the App Shell instantly (the route's `loading.tsx` skeleton), the param-specific content streams in, and Next upgrades the path in the background so later visitors get the cached render. The data layer (`loadSkill` in `lib/skill-cache.ts`; `loadAudits`/`loadSkillSyncData`/`loadStars` in `components/skill-detail-page.tsx`, plus per-page `loadOrg`/`loadRepo`/`loadSource`) uses `'use cache'` keyed by args, so `generateMetadata`, the page body and the OG route share one Convex call. The `skill-sync`-tagged loaders bust on the daily sync; `loadSkill` is `skill-content`-tagged and busts only when the row actually changes (see §1 caching).

> `fetchQuery` forces `cache: "no-store"` on its underlying fetch, which would block prerendering. Wrapping it in a `'use cache'` function isolates that behind a cache boundary and lets the route prerender. This is the standard pattern for any server-side Convex read.

**Partial Prerender for `/bundle/[id]`.** It's the shareable artifact — its most important traffic is cold loads of shared links by visitors with no warm Clerk/Convex session. Access control is the bundle's own `isPublic` flag plus optional auth; share tokens (`?share=`) were removed, and the page reads no `searchParams`. Its `loading.tsx` is the App Shell: the page reads auth cookies at the top, so the authed bundle content streams behind that boundary, and `generateMetadata` puts the bundle name/description in OG tags so links unfurl in chat apps. This is the only route using `preloadQuery`/`usePreloadedQuery`. It needs no `instant = false` — `loading.tsx` already makes it a valid `◐` route.

Both the page body and `generateMetadata` call `await io()` before touching
Convex, and **both are required — removing either brings the insight back.**
Without them, Next aborts the prerender for a misleading reason: Convex's
`preloadQuery` constructs a `ConvexHttpClient` whose default logger calls
`Math.random()`, and the resulting `blocking-prerender-random` insight points
into `node_modules` rather than at the real cause. The route *is* genuinely
per-request (it reads an auth cookie), so `io()` states that intent up front.
`<Suspense>` cannot substitute here: for *unstable values* the framework's own
remedy list offers only `[dynamic]`, `[cache]` and `[client]`, notably not
`[stream]`.

Two things about this were checked rather than assumed, because both are easy to
get wrong from memory:

- **`io()` has not replaced `connection()`.** The docs say to prefer `io()` and
  to reach for `connection()` when you need to wait for a real user request;
  both still exist.
- **The auth-cookie read does not make these calls redundant**, even though
  `io.md`'s "When you don't need `io()`" says a request-time API is itself the
  suspension point. Measured on a freshly restarted dev server against a real
  bundle: with both calls present the route is clean, and with either one
  removed `blocking-prerender-random` fires again. The mechanism was not chased
  further. Don't generalise it to "wrap every Convex call in `io()`" — what is
  established is the narrow case of a request-time route that preloads through a
  `ConvexHttpClient`.

**Deliberately NOT dynamic — compare.** `/compare` was briefly a path-param ISR route (`/compare/[[...refs]]`); it was reverted to a static page + `?skills=` query param because comparison combos are high-cardinality, order-sensitive, and rarely revisited — per-combo ISR entries (or per-request renders) pay for pages nobody loads twice, and crawlers could mint unbounded cache writes. With query params + client fetching there is exactly one route, and add/remove column is a shallow URL update with no navigation.

### Home leaderboard caching + cron revalidation

The home page's three leaderboards are cached with `'use cache'` + `cacheTag` (`home-popular`, `home-trending`, `home-hot`) and a `cacheLife` window (`days` for Popular, `hours` for Trending/Hot). The Convex leaderboard crons POST to `/api/revalidate` (shared-secret gated, tag allowlist) right after writing new ranks; the handler calls `revalidateTag(tag, { expire: 0 })` — Next's documented immediate-expiry pattern for webhooks — so the next visit rebuilds the snapshot rather than serving it stale-while-revalidate. The `cacheLife` windows are a safety net for a missed ping. This gives fresh-enough data with zero per-request Convex calls and no stale-then-live flash (the tabs render the snapshot directly, no client subscription).

> **All server caching uses `'use cache'`.** Every server-side cache in the app uses it — the home leaderboards, `official`, the catalog loaders, and the OG-image data loaders (`lib/og/images.tsx`) — with **no `unstable_cache` anywhere**. It's idiomatic and prerender-friendly (the cached result can land in the static shell).

**Does it actually persist across instances?** Measured on a preview deployment
rather than assumed, because the wording matters and Vercel's own docs reserve
`'use cache: remote'` for their Runtime Cache. Hitting a **cold, never-requested**
catalog URL four times:

```text
hit1  X-Vercel-Cache: PRERENDER   sfo1
hit2  X-Vercel-Cache: HIT         sfo1
hit3  X-Vercel-Cache: HIT         sfo1::iad1     <- different region, still a hit
hit4  X-Vercel-Cache: HIT         sfo1::iad1
```

So the practical answer is yes: the first visitor gets the App Shell
(`PRERENDER`) and the page upgrades in the background — the 16.3 ISR behaviour —
and every later request, **including from another region**, is served from
Vercel's shared cache. Convex is not hit per request.

The nuance worth keeping straight: what's shared here is the **rendered page
cache**, which is what `revalidateTag` invalidates. Don't restate this as
"`'use cache'` is the Data Cache" — plain `'use cache'` is documented as
in-memory per instance, and `'use cache: remote'` is the explicit opt-in to
Vercel's Runtime Cache. The app doesn't need `remote` today because its cached
reads all sit inside prerenderable pages. A loader that ran outside one (a Route
Handler, say) would not get this for free.

The route accepts a fixed allowlist of tags: `home-hot`, `home-trending`,
`home-popular`, `skill-sync`, and `skill-content`. The last two are split by
cadence, not by skill — `lib/skill-cache.ts` has the reasoning and
`convex/lib/revalidate.ts` mirrors the list as a `SiteTag` union so a typo on the
Convex side is a compile error rather than a swallowed 400.

**Verified in production (Aug 2026).** `/api/revalidate` does bust that shared
cache. Against `skillbundle.dev`, on a skill detail page:

```text
before   X-Vercel-Cache: HIT
POST /api/revalidate  {"tag":"skill-sync"}  ->  {"revalidated":true,"tag":"skill-sync"}
after    X-Vercel-Cache: REVALIDATED
```

`REVALIDATED` is the confirmation: Vercel held the entry, saw it invalidated, and
regenerated it. So the daily sync's ping reaches the shared cache and skill pages
refresh in lockstep with it, rather than drifting a full `cacheLife` window
behind. This closes the question of whether `'use cache: remote'` is needed for
the skill-detail loaders — it isn't.

The route's own logic was verified separately against a local production build:
401 on a wrong secret, `400 invalid_tag` outside the allowlist, and after a valid
POST the next request re-rendered before re-caching. That last check is the one
worth repeating if this code is ever touched — the deprecated one-argument
`revalidateTag(tag)` and `updateTag` (which throws outside a Server Action) would
both fail silently here, with a 200 and no invalidation.
>
> **OG image caching is separate from the data cache.** The OG routes are dynamic (`ƒ`) because they read `params`, so the `'use cache'` loaders only cache the *Convex data*. The rendered *PNG* for the data-backed OG routes (skill / org / repo / source / bundle) is cached at the CDN via an opt-in `Cache-Control: s-maxage=86400, stale-while-revalidate` header — `renderOg(node, { cache: true })` in `lib/og/templates.tsx` — restoring the daily route cache the old `export const revalidate` provided before Cache Components disallowed it. **That header is what keeps images from regenerating on every link**, independent of the data loaders. The static section cards (`/compare`, `/official`, `/pricing`, root) are `○` and keep Next's build-time static optimization (no header). The brand fonts are read once at module load (`lib/og/fonts.ts`), never inside a render: under Cache Components a render-time `readFile` counts as an async filesystem operation and would flip these otherwise-static routes to `ƒ` (it did, non-deterministically, before the read was hoisted to module scope).

---

## 2. The Suspense-with-Default-State-Fallback Pattern

This is the load-bearing pattern that keeps routes static while using nuqs/`useSearchParams`.

### The problem

Any client component calling `useSearchParams()` — which includes every nuqs `useQueryState` consumer, since the `next/app` adapter wraps it — **suspends during static prerendering** (the params aren't knowable at build). Without a `<Suspense>` boundary the production build fails (`Missing Suspense boundary with useSearchParams`). With a boundary, whatever the boundary's *fallback* renders is what lands in the prerendered HTML.

So the fallback is not a loading state — **it is the page's static shell.** A bare/empty fallback means a blank page until hydration.

### The pattern

Each route wraps its params-reading client island in a `<Suspense>` whose fallback renders the **default no-params state of the real UI** — real content, pixel-identical to what the live component shows when no params are set:

```tsx
// app/(main)/page.tsx (server, static)
<Suspense fallback={<HomeFallback hero={hero} {...initialData} />}>
  <HomeContent {...initialData}>{hero}</HomeContent>
</Suspense>
```

- The static HTML contains the full default page (home: hero + search bar + the real popular leaderboard, since that data is server-cached and available at build).
- On the client, `useSearchParams` resolves synchronously, so at hydration React swaps the fallback DOM for the live tree. With no params set, they're identical — invisible. With params (`/?q=x`), the default state paints first and the param state applies after hydration. That trade-off is accepted (and matches in-session behavior).
- **Fallbacks must not call `useSearchParams`/`useQueryState`** (they'd re-suspend). To avoid duplicating markup, components are split into a presentational `*View` (state via props) + a thin nuqs-backed wrapper — e.g. `DefaultSkillsListView`/`DefaultSkillsList`, `ExploreFiltersView`, `ExploreTabsView`, `CustomSettingsPageView`. The fallback renders the View with default values.
- Where the default state is unknowable (compare: column count lives in the URL), the fallback is a state-neutral skeleton instead.
- **A prerendered client component must also avoid unstable reads during render** — `Date.now()`, `Math.random()`, or a library that reads them. The home Popular list uses `useInfiniteQuery`, whose observer reads `Date.now()` during render; `PopularList` therefore renders its server-cached first page statically and only mounts the query-backed infinite list once the client takes over (gated on the `useHydrated` hook — a `useSyncExternalStore` flag), keeping the prerender clean while the real leaderboard data still lands in the shell.

Per-route fallbacks: `HomeFallback` (exported from `app/(main)/home-content.tsx`), `CustomSettingsPageView` (settings), `CompareFallback` (in compare's page.tsx).

### Docs grounding

Next.js recommends fallbacks that are "meaningful" and "match the dimensions of the content" (streaming guide); rendering the actual default UI is the maximal version of that. nuqs's own docs prescribe the same structure (server page → Suspense → client island).

### Keeping fallbacks in step with the page

**When you restructure a page, update its `loading.tsx` / Suspense fallback in
the same change.** Nothing catches this drift automatically, and it fails in a
way that doesn't look like drift.

`/bundle/[id]` is the worked example. The page was rebuilt as a register table;
its `loading.tsx` was left describing the version before that — a Fork/Star
action row that no longer existed, a tall install block that had become a
collapsed disclosure, and a three-column card grid where the page now rendered a
table, with the sections in the old order. Every visitor got a shell that
resolved into a visibly *different* layout, which reads as the skeleton being
replaced by a second, different skeleton rather than as a stale fallback.

Two habits that make a fallback survive the next redesign:

- **Wrap type-scale, don't hardcode heights.** A bar inside
  `<div className="text-4xl md:text-5xl">…<Skeleton className="h-[1em]" /></div>`
  tracks the real element's line box at every breakpoint; `h-12 md:h-14` silently
  stops matching the first time the type scale moves.
- **Don't reserve space for conditional UI.** The bundle action row is
  `empty:hidden` and renders nothing for non-owners — the common case for a
  shared link — so drawing buttons there guaranteed a shift for exactly the
  visitor the route exists for. Same for optional fields like a description.

The e2e guards in `e2e/instant-navigation.spec.ts` assert that a shell *commits
instantly*, not that it *resembles the page*. They cannot catch this; a look at
the route after restructuring it can.

---

## 3. Authentication Setup

### How the pieces connect

```text
Browser                     Next.js Server              Convex Backend
───────                     ──────────────              ──────────────
User clicks "Sign in"
       │
       ├──► Clerk hosted UI / components
       │    User authenticates via Clerk
       │              │
       │              ◄── Session created, JWT issued
       ◄──────────────
ClerkProvider has session
       │
       ├──► ConvexProviderWithClerk
       │    calls useAuth() to get token
       │    passes JWT to ConvexReactClient
       │              │
       │              ├──► Convex validates JWT
       │              │    against Clerk's public key
       │              │    (issuer domain in auth.config.ts)
       │              │
       │              ◄── Auth confirmed, queries execute
       ◄──────────────

Separately (async):
Clerk ──► POST /clerk-users-webhook ──► Convex HTTP action
          Svix validates signature         upserts user in DB
```

### Convex auth config

`convex/auth.config.ts` — tells Convex how to validate Clerk JWTs:

```ts
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
```

Set `CLERK_JWT_ISSUER_DOMAIN` on the Convex dashboard. Development: `https://verb-noun-00.clerk.accounts.dev`. Production: `https://clerk.<your-domain>.com`.

### Clerk webhook handler

`convex/http.ts` — syncs Clerk user events to the Convex `users` table (`user.created` / `user.updated` / `user.deleted`), validated with Svix HMAC signatures. Set `CLERK_WEBHOOK_SECRET` on the Convex dashboard.

### User helpers in Convex

`convex/users.ts`:

```ts
export async function getCurrentUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) return null;
  return await userByExternalId(ctx, identity.subject);
}

export async function getCurrentUserOrThrow(ctx: QueryCtx) {
  const userRecord = await getCurrentUser(ctx);
  if (!userRecord) throw new Error("Can't get current user");
  return userRecord;
}
```

`identity.subject` is Clerk's `userId`, matched against `users.externalId`.

### Server-side auth helpers

`lib/auth.ts` — used by the remaining server-side consumers (the bundle page, server actions, `/dev` admin pages):

- `getAuth()` — React-`cache()`d wrapper around Clerk's `auth()` (dedupes cookie parsing within a request).
- `getAuthToken()` — Convex-template JWT for `preloadQuery`/`fetchQuery`; catches `ClerkOfflineError` (Core 3 throws instead of returning null when offline).
- `verifySession()` — auth check + redirect to `/sign-in`; `cache()`d.
- `verifyAdmin()` — `verifySession` + Convex admin check for `/dev` routes.

### Clerk middleware

`proxy.ts` — **an explicit private-route list, not a public list**:

```ts
// Inverted from public-list because the org matchers (`/:org`, `/:org/:repo`)
// match any single/double-segment path — including `/dashboard`, `/settings`,
// `/dev` — making them silently public. createRouteMatcher does pattern
// matching, not routing precedence.
const isPrivateRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/settings(.*)",
  "/dev(.*)",
]);
```

This inversion matters anywhere route lists exist in this app: because the catch-all org routes shadow everything, enumerate the finite, knowable side rather than trusting exclusion. For auth that means **allow-list the private routes, never exclude-list** — a missed exclusion would silently make a route public. `GlobalBundleBar` (§5) is the deliberate inverse: it *block*-lists a few reserved non-browse segments, which is safe only because an over-broad match there is cosmetic (the bar self-hides on an empty selection), not a security hole.

---

## 4. Auth Protection Layers

| Layer              | Where                       | How                                              | Protects                 |
| ------------------ | --------------------------- | ------------------------------------------------ | ------------------------ |
| Route protection   | `proxy.ts` (middleware)     | `auth.protect()` on private routes               | Page access (redirect)   |
| Data protection    | Convex functions            | `getCurrentUserOrThrow(ctx)` + ownership checks  | The actual data          |
| Action protection  | Server actions              | `verifySession()` at the top                     | Server-side operations   |

Static auth-gated pages (`/dashboard`, `/settings`) intentionally have **no page-level auth check** — there's nothing to protect in the shell (no user data), the middleware gates access, and every Convex query/mutation/action checks auth itself. The shells being publicly cacheable is by design. Pages that fetch user data server-side (`/bundle/[id]`, server actions like `getSessions`) keep their explicit server-side auth.

```ts
// convex — the final gate, always present
export const listByUser = query({
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    return ctx.db.query("bundles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();
  },
});
```

---

## 5. Provider Setup

`ClerkProvider` must wrap `ConvexProviderWithClerk` — Convex needs Clerk's context.

```text
app/layout.tsx (Server Component — plain <html><body>, no Suspense)
  └─ <Providers>                          (app/providers.tsx, "use client")
       └─ NuqsAdapter                     (nuqs/adapters/next/app)
            └─ ClerkProvider              (prefetchUI={false} — see note)
                 └─ ConvexClientProvider  (app/ConvexClientProvider.tsx)
                      └─ ConvexProviderWithClerk
                           └─ QueryClientProvider (TanStack Query)
                                └─ ThemeProvider   (next-themes, disableTransitionOnChange)
                                     └─ ToastProvider / AnchoredToastProvider
                                          └─ {children}

app/(main)/layout.tsx
  └─ AppHeader + {children} + GlobalBundleBar
```

Notes:

- **`ClerkProvider prefetchUI={false}`** — the app uses Clerk only through headless hooks and never mounts a prebuilt component, so the ~262 KiB prebuilt-UI bundle is skipped.
- **`ThemeProvider disableTransitionOnChange`** — next-themes injects a global `* { transition: none !important }` for a moment while applying the theme class, **including at hydration**. Any animation that fires in the first ~15ms after hydration gets eaten by it (this is why `BundleBar` defers its entrance by two rAFs — see §9).
- **`GlobalBundleBar`** lives in the `(main)` layout, not per page, so the same component instance (and its open/collapsed state) persists across browse navigations. It reads `usePathname()` to show on browse routes only (an inverted reserved-segment list per the §3 rule) — which suspends while a dynamic route's App Shell is generated, so it sits behind `<Suspense fallback={null}>` (the bar self-hides on an empty selection, so the null fallback is correct).

### ConvexClientProvider

Bridges Clerk to Convex and wires TanStack Query through `@convex-dev/react-query` (`queryKeyHashFn`/`queryFn` from `ConvexQueryClient`), so `useQuery(convexQuery(...))` calls are live Convex subscriptions with React Query caching semantics. The websocket connects once at app load and stays open/authenticated for the whole session — this is what makes "static shell + client data" navigation fast.

> `useAuth` from `@clerk/nextjs` is passed as a prop to `ConvexProviderWithClerk`. That's its one correct use; everywhere else use `useConvexAuth()` from `convex/react`.

---

## 6. App Header

`AppHeader` is a server component rendering a static shell; the interactive pieces are client components behind small Suspense boundaries with skeleton fallbacks (`DesktopNav`, `ThemeSwitcher`). Auth UI is **fully client-side** (`HeaderAuthClient`): reading the auth cookie on the server would make every route `◐` and add a per-request function to stream the header's auth state, pulling load onto Vercel functions — against the §1.3 keep-load-off-functions rule — so it resolves on the client (over the already-open Convex/Clerk connection) instead. (An earlier Cache Components iteration used a server-component nav; client-side is the better fit for a mostly-signed-out public directory.) Signed-out users see the Sign in button after hydration; signed-in users get the user menu via Clerk's `useUser()`.

---

## 7. Client-Side Auth State

Use Convex's auth hooks — not Clerk's — for UI that depends on auth state, so the JWT has been fetched **and validated by Convex** before authenticated content renders.

| Hook | From | Returns | Use when |
| --- | --- | --- | --- |
| `useConvexAuth()` | `convex/react` | `{ isAuthenticated, isLoading }` | Checking auth state in components |
| `useAuth()` | `@clerk/nextjs` | `{ isSignedIn, userId, ... }` | **Only** as a prop to `ConvexProviderWithClerk` |

Skip queries for unauthenticated users (`"skip"` = no subscription, no round-trip), and check `isLoading` to avoid flashing wrong defaults during auth hydration:

```tsx
// hooks/use-user-plan.ts
export function useUserPlan() {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const { data: result, isPending, isError } = useQuery({
    ...convexQuery(api.plans.currentPlan, isAuthenticated ? {} : "skip"),
    enabled: isAuthenticated,
  });

  return {
    plan: (result?.plan ?? "free") as Plan,
    limits: result?.limits ?? null,
    gatingEnabled: result?.gatingEnabled ?? false,
    // Fully resolved: auth AND the plan query.
    isLoading: authLoading || (isAuthenticated && isPending),
    // Auth-only readiness — see the two rules below.
    isAuthLoading: authLoading,
    // Plan query failed: "unknown", never "free".
    isPlanError: isAuthenticated && isError,
  };
}
```

Two rules the extra fields encode (established by the repo-match paywall,
`components/repo-url-input.tsx`):

- **Gate fetches on auth readiness, not plan resolution.** A caller that only
  needs the Convex JWT attached should watch `isAuthLoading`, so its request
  runs in parallel with the plan round-trip instead of serially behind it. The
  server is the authoritative gate for plan-restricted work — client plan
  checks exist only to skip round-trips that are known to fail.
- **A failed plan query means "unknown", never "free".** Gate on
  `isPlanError` separately from `limits` being null, otherwise a websocket
  blip shows a paying user the paywall with no way to recover. When the plan
  is unknown, fall through to the server and let it decide.

---

## 8. Data Fetching Patterns

### Pattern: client fetch on a static page (the default)

Per-user or interactive data on static routes. `undefined` covers both "auth handshake in flight" and "query loading":

```tsx
// app/(main)/dashboard/dashboard-content.tsx
const bundles = useQuery(api.bundles.listByUser);   // convex/react
const planData = useQuery(api.plans.currentPlan);
if (bundles === undefined || planData === undefined) return <DashboardSkeleton />;
return <DashboardLoaded bundles={bundles} planData={planData} />;
```

Two client-query flavors coexist:

- **`useQuery` from `convex/react`** — when mutations with optimistic updates target the same query (dashboard): the optimistic `localStore` writes flow straight into these subscriptions.
- **`useQuery(convexQuery(...))` via TanStack** — when React Query semantics help: `placeholderData: keepPreviousData` for search-as-you-type, `staleTime`/`gcTime` session caching (compare columns, pickers, skill history diffs).

### Pattern: `'use cache'` + `fetchQuery` server loaders (catalog routes)

```tsx
// lib/skill-cache.ts
export async function loadSkill(source: string, skillId: string) {
  "use cache";
  cacheLife("weeks");
  cacheTag(SKILL_CONTENT_TAG);
  return fetchQuery(api.skills.getBySourceAndSkillId, { source, skillId });
}
```

The cache key is derived from the args (plus the build ID), so the entry is shared across `generateMetadata`, the page body, and the OG route — that sharing is why it lives in `lib/` rather than beside the page's other loaders. Cross-user: one Convex call per skill per `cacheLife` window, total. The cached result lands in the route's static shell.

Note the tags. `skill-content` covers the skill row and is pinged only by jobs that mutate it, which is what makes the long `cacheLife("weeks")` safe; `skill-audit` does the same for the audit list on its own weekly cadence; `skill-sync` covers install counts and churns catalog-wide every morning. Never put a daily-cadence field behind either of the long-lived tags — `lib/skill-cache.ts` is the canonical writeup, including what the split does *not* yet buy.

> A considered-and-rejected extension: exposing `loadSkill` to the client via a GET route handler so compare/detail-sheet fetches share this cache. Rejected on plan economics (it trades Convex Pro calls for capped Vercel Hobby invocations) — see the note in `app/(main)/compare/compare-content.tsx`.

### Pattern: `preloadQuery` + `usePreloadedQuery` (bundle page only)

Server preloads with the user's token; the client hydrates the result into a live subscription:

```tsx
const [preloadedBundle, preloadedPlan] = await Promise.all([
  preloadQuery(api.bundles.getByUrlId, { urlId: id }, { token }),
  preloadQuery(api.plans.currentPlan, {}, { token }),
]);
return <BundleView preloadedBundle={preloadedBundle} ... />;
```

### Pattern: server actions for auth-bound server reads

`/settings`'s sessions list needs Clerk's backend API. It's a server action (`getSessions` in `app/(main)/settings/actions.ts`) called from the client via React Query — fetched only when the Security tab actually mounts, keeping the page static. Actions are POSTs (never HTTP-cached): right for per-user reads and mutations, wrong for cacheable public data.

### Pattern: mutations with optimistic updates

```tsx
const deleteBundle = useMutation(api.bundles.deleteBundle)
  .withOptimisticUpdate((localStore, { bundleId }) => {
    const current = localStore.getQuery(api.bundles.listByUser, {});
    if (current !== undefined) {
      localStore.setQuery(api.bundles.listByUser, {},
        current.filter((b) => b._id !== bundleId));
    }
  });
```

### Pattern: Convex full-text search

Search index in the schema, `withSearchIndex` in queries; search reads go against the slim `skillSummaries` table (~200 B/row) instead of `skills` (~25 KB/row) to keep result sets small on the wire.

---

## 9. Hydration-Safe Client State (localStorage etc.)

The static shell can never contain client-only state (localStorage, theme, etc.). Three rules keep that from causing bugs:

1. **Reads of client-only state must report the server-knowable value during the hydration render.** `hooks/use-hydrated.ts` (`useSyncExternalStore`, false during SSR/hydration, true after) gates `useIsSkillSelected` / `useIsSelectionAtCap` in `lib/bundle-selection.ts`. Without this, any early subscriber (e.g. the layout-mounted `BundleBar`) can load the stored value *before* React lazily hydrates the skill-list island — the rows then hydrate as "checked" against unchecked server HTML → hydration mismatch → full client re-render. The jotai atom itself uses `atomWithStorage(..., { getOnInit: false })` for the same reason.
2. **State arriving post-hydration should animate, not pop.** Because the flip happens between two painted frames on persistent DOM, CSS transitions fire naturally (row selection highlights). For elements that *mount* with the state (BundleBar's sheet), entrance animation needs either `@starting-style` (Tailwind `starting:` — animates insertion itself) or a deferred open. BundleBar uses both: `starting:` classes plus a two-rAF `enterReady` delay, the latter because next-themes' transition kill-switch (§5) eats any transition in the first frames after hydration.
3. **Expected pop-in is accepted, not hidden.** Selections appearing a beat after the static shell paints is the honest cost of static + localStorage; the old architecture only looked "instant" because the page was blank until JS ran.

---

## 10. URL State Management (nuqs)

### Setup

`NuqsAdapter` (`nuqs/adapters/next/app`) wraps the app. All parsers live in `lib/search-params.ts` — including a custom `compareSkillsParser` built with `createParser` (parse/serialize/eq for the `SkillRef[]` list, with dedupe + cap baked into parsing so hand-edited URLs normalize).

Params are read **client-side only** (no server loaders — the routes are static, so there is no server render that could see them). Every `useQueryState` consumer therefore needs the §2 Suspense pattern.

```tsx
const [refs, setRefs] = useQueryState("skills", compareSkillsParser);
setRefs(next.length > 0 ? next : null);  // null removes the param entirely
```

Updates are shallow History API writes — no navigation, no server render. This is what makes compare's add/remove-column instant with the picker sheet staying open.

### Known quirk: hydration URL canonicalization

On hard loads, Next's router canonicalizes the address bar through `URLSearchParams` serialization, percent-encoding `/ : ,` (e.g. compare's `?skills=` becomes `%2F%3A%2C` soup) until the next in-page nuqs write restores the readable form. Both forms decode identically — purely cosmetic. **Don't fight it:** a one-time mount `history.replaceState` was tried and measurably loses the race (the router's write lands later). The compare page's "Copy link" button builds links via `compareHref()` instead, guaranteeing readable shared URLs regardless of the address bar.

Related: catch-all route params arrive percent-encoded to the page but decoded to `generateMetadata` — decode defensively if you ever parse them.

---

## 11. Billing / Subscriptions

The `@convex-dev/polar` component is registered in `convex/convex.config.ts` and manages subscription data via webhooks. Polar is the Merchant of Record.

```text
User clicks "Upgrade to Pro"
       ├──► CheckoutLink generates Polar checkout URL
       │    User completes payment on Polar
       │              ├──► Polar webhook → /polar/events
       │              │    @convex-dev/polar stores subscription in Convex
       ◄──────────────
getUserPlan() returns "pro"
```

- `convex/lib/plans.ts` — `getUserPlan(ctx)` (maps Polar `productKey` → plan), `getPlanLimits(plan)`, `FEATURE_GATING_ENABLED` master switch (when `false`, all users get full access).
- `convex/plans.ts` — `currentPlan` query for the frontend; `hooks/use-user-plan.ts` on the client.
- Enforcement is two-layer: Convex mutations check limits server-side; UI disables controls / shows upgrade prompts client-side.
- Webhooks in `convex/http.ts`: `POST /clerk-users-webhook` (Svix) and `POST /polar/events` (`polar.registerRoutes()`).

---

## 12. Request Lifecycles

### Static route (home, compare, dashboard, settings)

```text
1. CDN serves prerendered HTML immediately
   └─ Full default-state shell paints (hero, search bar, leaderboard / skeletons)
2. Middleware (proxy.ts) ran before serving — private routes redirect unauthenticated users
3. JS loads, React hydrates
   └─ Suspense islands swap fallback DOM for live trees (identical when no params)
   └─ nuqs applies any URL params; localStorage state flips in (§9)
4. Convex connection
   └─ ConvexProviderWithClerk fetches JWT via useAuth, websocket authenticates
   └─ Client queries resolve (skeletons → data); subscriptions stay live
5. Subsequent in-app navigations
   └─ Each route's App Shell is prefetched (one per route, shared across links) → instant paint
   └─ Queries run over the already-authenticated websocket → fast data
```

### Partial Prerender route (/bundle/[id], catalog routes)

```text
1. Navigation paints the prefetched App Shell instantly (loading.tsx skeleton)
2. Middleware → request reaches the function for the dynamic hole
3. generateMetadata + page run: params/searchParams/cookies read,
   preloadQuery (bundle) / 'use cache' loaders (catalog) fetch the content
4. The content streams into the shell; client hydrates
   (bundle: usePreloadedQuery seeds the live subscription)
```

---

## 13. User Sync Flow

Clerk user data syncs to Convex via webhooks, not client-side:

```text
Clerk (user signs up / updates profile / deletes account)
  ├──► POST <CONVEX_SITE_URL>/clerk-users-webhook  (svix-id/timestamp/signature)
  └──► convex/http.ts
       ├─ Svix validates signature
       ├─ user.created / user.updated → upsertFromClerk
       └─ user.deleted → deleteFromClerk
```

`ctx.auth.getUserIdentity().subject` === Clerk `userId` === `users.externalId`. The `users` table holds a denormalized `name`/`email`/`image` copy so Convex queries resolve display info without Clerk API calls. For profile *mutations*, use Clerk's `useUser()` (live `UserResource`).

---

## 14. Error Handling

Three layers, outermost first. Add to the innermost one that fits — don't
reach for a `try/catch` inside a Server Component, which swallows the error and
loses `retry()`.

| Layer | File | Catches | Keeps visible |
| --- | --- | --- | --- |
| Global | `app/global-error.tsx` | failures in the root layout itself | nothing — it replaces the document |
| Segment | `app/(main)/error.tsx` | anything thrown by a page in `(main)` | `AppHeader`, `GlobalBundleBar` |
| Segment | `app/(auth)/error.tsx` | a throw during sign-in / sign-up or an SSO callback | whatever `(auth)/layout.tsx` renders |
| Region | `components/data-error-boundary.tsx` | one data region's Suspense subtree | the whole page around it |

**There are two segment boundaries because `error.js` only wraps its own
segment.** Without the `(auth)` one, a Clerk render failure escaped all the way
to `global-error.tsx` — an unstyled document with no header and no route back
into the app, on the one flow a user cannot skip. Both segment files are thin:
the markup lives in `components/route-error-body.tsx` so the two cannot drift
into showing a user two different products for the same condition.

Four things worth knowing:

- **`retry()`, not `reset()`.** `reset()` only clears client state and
  re-renders; it cannot recover from a failed *Server Component* render, which
  is this app's realistic failure (a Convex read throwing). `retry()` re-fetches
  and re-runs the server render.
- **`global-error.tsx` does not get the app's stylesheet** (it renders its own
  document), so it is written with inline styles and a plain `<title>` —
  `metadata` exports are unsupported there. Its "Back home" link is a bare `<a>`
  on purpose: when the root layout has failed, the router isn't trustworthy and
  a hard document load is the reliable escape.
- **`DataErrorBoundary` wraps the `<Suspense>`, not the other way round**, so it
  covers the fallback too. It's built on `catchError` from `next/error`, whose
  fallback signature is unusual: `(props, errorInfo)` — two positional
  arguments. `notFound()` and `redirect()` still work through it (they throw
  special errors the boundary forwards); a bogus org still renders
  `app/(main)/not-found.tsx`.

`app/(main)/page.tsx` deliberately has **no** region boundary: its three cached
loaders run in a `Promise.all` *above* the Suspense, so a boundary there would
never see their failure, and restructuring the home page's static-shell pattern
is exactly the risk the history note at the top of this doc warns about. The
segment boundary covers it.

`app/(main)/bundle/[id]/page.tsx` has none for the same reason, plus one of its
own. Its awaits (`params`, `getAuthToken`, both `preloadQuery` calls) run in the
page body, so a rejection escapes before any boundary in the returned tree
exists — a `DataErrorBoundary` there catches only client render errors while
reading as protection against a Convex outage. And the obvious repair, moving
the awaits into a Suspense-wrapped child, is unavailable: this route's shell is
`loading.tsx`, so an in-page boundary would give it two loading surfaces, the
"pick one, not both" failure in §1. The segment boundary covers it.

The general rule: **a region boundary is only worth adding where the awaiting
component sits inside it.** That holds on skill detail and the three listing
routes, and does not hold anywhere the loaders run in the page body.

---

## 15. Instant-navigation guards (e2e)

`e2e/instant-navigation.spec.ts` is the regression guard for §1. It uses
`instant()` from `@next/playwright`, which pauses a navigation at its static
shell: anything asserted **inside** the callback had to be available with no
network, anything asserted **after** is allowed to stream.

```bash
pnpm e2e          # headless
pnpm e2e:ui       # Playwright UI
```

Three Playwright projects:

| Project | Runs | Signed in? |
| --- | --- | --- |
| `chromium` | `e2e/*.spec.ts` — the instant-navigation guards | no |
| `setup` | `e2e/auth.setup.ts` — signs in once, saves storage state | — |
| `chromium-authed` | `e2e/authenticated/*.spec.ts` | yes |

The last two only register when `CLERK_SECRET_KEY` is an `sk_test_*` key
(see `playwright.config.ts`), so a checkout without Clerk dev keys just runs the
signed-out half instead of failing on a missing storage-state file.

**Authenticated tests are functional, not instant-navigation, coverage.**
`/dashboard` and `/settings` are already `○` — their shells hold no user data,
because per-user data arrives client-side over the Convex websocket. So they
commit instantly by construction; what needed testing was that sign-in works,
that the proxy doesn't bounce a signed-in user, and that the authed websocket
actually resolves. `/dev` is the only `◐` route behind auth, and it's admin-only.

Sign-in uses no mailbox: Clerk dev instances treat any address containing
`+clerk_test` as a test identity with a fixed verification code, so
`clerk.signIn({ strategy: 'email_code' })` works headlessly. `clerkSetup()`
separately mints a Testing Token that stops bot protection blocking it. The test
user is find-or-created through `@clerk/backend`, so a wiped Clerk instance needs
no manual setup. `auth.setup.ts` refuses to run against a non-`sk_test_` key.

Non-obvious things that will bite you:

- **It runs against a production build**, not `next dev` — `playwright.config.ts`
  sets `webServer` to `pnpm build && pnpm start` on port 3100. Next does no
  prefetching in dev, so there'd be no shell to pause at. `E2E=1` turns on
  `experimental.exposeTestingApiInProductionBuild`, and it must be set for the
  *build*, not just the server.
- **Scope assertions to `:visible` after a client navigation.** Cache Components
  keeps the previous route mounted-but-hidden via `<Activity>` instead of
  unmounting it, so an unscoped locator happily matches the outgoing page and
  reports `hidden`.
- **Roles don't match the JSX.** cubby-ui's `Button render={<Link/>}` yields
  `role="button"`, and the header nav and home skill rows are buttons and
  checkboxes, not links. Only the catalog listing rows are real anchors.
- **`e2e/` is Playwright; `tests/` is vitest.** Different runners, deliberately
  non-overlapping globs (`*.spec.ts` under `e2e/` vs `tests/**/*.test.ts`).
  Don't put one kind in the other's directory.
- **Assertions inside an `instant()` scope use a long timeout** (`SHELL_TIMEOUT`).
  That doesn't weaken them: the navigation is paused for the whole scope, so no
  server data can arrive no matter how long you wait — the extra time only
  absorbs local render scheduling, which made the client-nav assertions flaky
  once the suite grew to three parallel projects.
- **`playwright.config.ts` parses `.env.local` itself.** Next loads it for the
  app it builds, but the Playwright process gets nothing, so the Clerk keys the
  auth setup needs would otherwise be invisible. Existing env always wins, so CI
  secrets are unaffected.

**Instant Insights (the DevTools panel) is the other half of this**, and it does
work — but with one trap. A `next dev` process left running across many HMR
cycles starts throwing
`InvariantError: Cannot access "moduleLoading" without a work store`
(from `app-render/instant-validation/`) on nearly every route, static and
dynamic alike. It reads exactly like a framework bug and it is not: **restart the
dev server** and every route validates clean, non-prerendered dynamic params
included. Don't trust that invariant without restarting first.

Insights surface via the DevTools overlay or MCP `get_errors` — **not** the dev
log, which never mentions them. Note `get_errors` reports only the most recently
navigated URL, so check it after each navigation rather than at the end of a
sweep.

`experimental.instantInsights.validationLevel` is pinned to `'warning'` in
`next.config.ts` because the docs warn the framework default may change to a
build-gating level (`'experimental-error'`) without that counting as breaking.

---

## File Structure (architecture-relevant)

```text
lib/
  auth.ts                   # getAuth, getAuthToken, verifySession, verifyAdmin
  search-params.ts          # ALL nuqs parsers (incl. custom compareSkillsParser)
  compare.ts                # SkillRef helpers, parse/serialize, compareHref
  bundle-selection.ts       # jotai atomWithStorage + hydration-gated read hooks

hooks/
  use-hydrated.ts           # false during SSR/hydration render, true after
  use-user-plan.ts          # plan/limits, auth-aware skip + loading
  use-debounced-query-value.ts  # shared search debounce + cache bypass + spinner derivation

convex/
  convex.config.ts          # registers @convex-dev/polar
  auth.config.ts            # Clerk JWT issuer
  http.ts                   # Clerk + Polar webhooks
  schema.ts / users.ts / bundles.ts / skills.ts / plans.ts / crons.ts

app/
  layout.tsx                # plain <html><body> — NO root Suspense
  global-error.tsx          # last resort: root-layout failures; own <html>, inline styles, retry()
  providers.tsx             # NuqsAdapter → Clerk(prefetchUI:false) → Convex → Theme → Toast
  ConvexClientProvider.tsx  # ConvexProviderWithClerk + TanStack wiring
  api/revalidate/route.ts   # secret-gated tag revalidation (Convex crons call it)
  api/skills-token/route.ts # secret-gated Vercel OIDC token relay for the Convex skills.sh sync
  (main)/
    layout.tsx              # AppHeader + children + GlobalBundleBar
    error.tsx               # segment boundary for every user-facing page; keeps header, retry()
    page.tsx                # static; Suspense + HomeFallback (mirrored default state)
    compare/                # static; nuqs skills param, client columns, picker sheet
    dashboard/              # static; client useQuery + DashboardSkeleton gate
    settings/               # static; getSessions server action in actions.ts
    bundle/[id]/            # ◐; loading.tsx shell + await io() + preloadQuery + generateMetadata
    [org]/...  site/...     # ◐; gSP returns 1 representative param, 'use cache' loaders.
                            #    Listing routes: SYNC page, params promise into
                            #    Suspense, NO loading.tsx. Skill routes: loading.tsx
                            #    IS the shell (all content is params-derived). §1

components/
  app-header.tsx            # server shell; client islands in Suspense
  header-auth-client.tsx    # fully client auth UI (keeps routes static)
  global-bundle-bar.tsx     # layout-mounted, pathname reserved-segment BLOCK-list, <Suspense fallback={null}>
  bundle-bar.tsx            # deferred entrance (rAF×2) + @starting-style
  data-error-boundary.tsx   # catchError() region boundary + retry() — wraps the data <Suspense>es
  skill-detail-page.tsx     # loadAudits/loadSkillSyncData/loadStars ('use cache' + cacheTag loaders)
  skill-history.tsx         # server: History timeline, data passed in as a prop
  skill-history-row.tsx     # client: per-row open/compare state + lazy diff
  header-nav.tsx            # DesktopNav — usePathname read behind <Suspense>

lib/
  skill-cache.ts            # SKILL_SYNC_TAG/SKILL_CONTENT_TAG + shared loadSkill (page + metadata + OG)
  representative-params.ts  # picks 1 representative param per catalog route (popular skill + fallback)

e2e/                        # Playwright (see §15); NOT vitest — different runner
  instant-navigation.spec.ts  # signed-out instant() guards
  auth.setup.ts               # signs in once, saves storage state
  authenticated/              # signed-in functional coverage
  fixtures.ts
playwright.config.ts        # webServer = `pnpm build && pnpm start`, E2E=1

proxy.ts                    # Clerk middleware — PRIVATE-route list (inverted)
next.config.ts              # cacheComponents + partialPrefetching; optimizePackageImports
```
