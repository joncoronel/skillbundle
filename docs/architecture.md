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
| `/explore` | `○` Static | All data client-fetched (Convex `useQuery`) |
| `/compare` | `○` Static | Skills in `?skills=` param (nuqs), one client Convex query per column |
| `/settings` | `○` Static | Clerk hooks client-side; sessions via server action, fetched on demand |
| `/dashboard` | `○` Static | `listByUser` + `currentPlan` client-fetched over the authed websocket |
| `/official`, `/pricing` | `○` Static | official: `'use cache'` curated owners loader |
| `/[org]`, `/[org]/[repo]`, `/[org]/[repo]/[skillId]`, `/site/...` | `◐` Partial Prerender | `generateStaticParams` returns one representative param (App Shell prerenders); unknown params get the shell instantly via `loading.tsx`, then upgrade. Data via `'use cache'` + `cacheTag('skill-sync')` loaders |
| `/bundle/[id]`, `/dev`, `/dev/add-skill` | `◐` Partial Prerender | bundle: `loading.tsx` shell + `preloadQuery` authed content streams in; dev: `verifyAdmin()` streams behind a Suspense gate |
| `/*/opengraph-image`, `/bundle/[id]/og/[v]`, `/api/revalidate` | `ƒ` Dynamic | OG images (data via `'use cache'`, rendered PNG CDN-cached via `Cache-Control`); revalidate webhook (secret-gated, called by Convex crons) |

### Why each type

**Static + client data (most routes).** The whole page shell — including a meaningful default state, see §8 — prerenders at build. Navigation between these routes is instant (full prefetch). Per-user or interactive data arrives via the client Convex connection, which the root provider keeps open and authenticated across the whole session, so in-app navigations pay no handshake.

**Partial Prerender for the catalog routes.** Skill/org/repo pages are public, high-cardinality, and shared. `generateStaticParams` returns one representative param (`lib/representative-params.ts` reads the top popular skill of each source type — memoized at module scope so the build resolves each lookup once, not once per route — with a known-good fallback) so Next can prerender the route's App Shell. `dynamicParams: true` is the default: a visitor to an unknown path gets the App Shell instantly (the route's `loading.tsx` skeleton), the param-specific content streams in, and Next upgrades the path in the background so later visitors get the cached render. The data layer (`loadSkill`, `loadAudits`, etc. in `components/skill-detail-page.tsx`, plus per-page `loadOrg`/`loadRepo`/`loadSource`) uses `'use cache'` keyed by args, so `generateMetadata` and the page body share one Convex call, and the `skill-sync`-tagged loaders bust on the daily sync (see §1 caching).

> `fetchQuery` forces `cache: "no-store"` on its underlying fetch, which would block prerendering. Wrapping it in a `'use cache'` function isolates that behind a cache boundary and lets the route prerender. This is the standard pattern for any server-side Convex read.

**Partial Prerender for `/bundle/[id]`.** It's the shareable artifact — its most important traffic is cold loads of shared links by visitors with no warm Clerk/Convex session, and access control involves share tokens (`?share=`) plus optional auth. Its `loading.tsx` is the App Shell: the page reads auth cookies + the share token at the top, so the authed bundle content streams behind that boundary, and `generateMetadata` puts the bundle name/description in OG tags so links unfurl in chat apps. This is the only route using `preloadQuery`/`usePreloadedQuery`. It needs no `instant = false` — `loading.tsx` already makes it a valid `◐` route.

**Deliberately NOT dynamic — compare.** `/compare` was briefly a path-param ISR route (`/compare/[[...refs]]`); it was reverted to a static page + `?skills=` query param because comparison combos are high-cardinality, order-sensitive, and rarely revisited — per-combo ISR entries (or per-request renders) pay for pages nobody loads twice, and crawlers could mint unbounded cache writes. With query params + client fetching there is exactly one route, and add/remove column is a shallow URL update with no navigation.

### Home leaderboard caching + cron revalidation

The home page's three leaderboards are cached with `'use cache'` + `cacheTag` (`home-popular`, `home-trending`, `home-hot`) and a `cacheLife` window (`days` for Popular, `hours` for Trending/Hot). The Convex leaderboard crons POST to `/api/revalidate` (shared-secret gated, tag allowlist) right after writing new ranks; the handler calls `revalidateTag(tag, { expire: 0 })` — Next's documented immediate-expiry pattern for webhooks — so the next visit rebuilds the snapshot rather than serving it stale-while-revalidate. The `cacheLife` windows are a safety net for a missed ping. This gives fresh-enough data with zero per-request Convex calls and no stale-then-live flash (the tabs render the snapshot directly, no client subscription).

> **All server caching uses `'use cache'`.** On Vercel, `'use cache'` is backed by the Data Cache, so cross-user snapshots persist across requests and instances. Every server-side cache in the app uses it — the home leaderboards, `official`, the catalog loaders, and the OG-image data loaders (`lib/og/images.tsx`) — with **no `unstable_cache` anywhere**. It's idiomatic and prerender-friendly (the cached result can land in the static shell).
>
> **OG image caching is separate from the data cache.** The OG routes are dynamic (`ƒ`) because they read `params`, so the `'use cache'` loaders only cache the *Convex data*. The rendered *PNG* for the data-backed OG routes (skill / org / repo / source / bundle) is cached at the CDN via an opt-in `Cache-Control: s-maxage=86400, stale-while-revalidate` header — `renderOg(node, { cache: true })` in `lib/og/templates.tsx` — restoring the daily route cache the old `export const revalidate` provided before Cache Components disallowed it. **That header is what keeps images from regenerating on every link**, independent of the data loaders. The static section cards (`/explore`, `/compare`, `/official`, `/pricing`, root) are `○` and keep Next's build-time static optimization (no header). The brand fonts are read once at module load (`lib/og/fonts.ts`), never inside a render: under Cache Components a render-time `readFile` counts as an async filesystem operation and would flip these otherwise-static routes to `ƒ` (it did, non-deterministically, before the read was hoisted to module scope).

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
- **A prerendered client component must also avoid unstable reads during render** — `Date.now()`, `Math.random()`, or a library that reads them. The home Popular list uses `useInfiniteQuery`, whose observer reads `Date.now()` during render; `PopularList` therefore renders its server-cached first page statically and only mounts the query-backed infinite list once the client takes over (`useSyncExternalStore`-based `useIsClient`), keeping the prerender clean while the real leaderboard data still lands in the shell.

Per-route fallbacks: `app/(main)/home-fallback.tsx`, `components/explore/explore-fallback.tsx`, `CustomSettingsPageView` (settings), `CompareFallback` (in compare's page.tsx).

### Docs grounding

Next.js recommends fallbacks that are "meaningful" and "match the dimensions of the content" (streaming guide); rendering the actual default UI is the maximal version of that. nuqs's own docs prescribe the same structure (server page → Suspense → client island).

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

This inversion matters anywhere route lists exist in this app (see also `GlobalBundleBar`'s allow-list): because the catch-all org routes shadow everything, **always allow-list, never exclude-list.**

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
  const result = useQuery(api.plans.currentPlan, isAuthenticated ? {} : "skip");
  return {
    plan: (result?.plan ?? "free") as Plan,
    limits: result?.limits ?? null,
    gatingEnabled: result?.gatingEnabled ?? false,
    isLoading: authLoading || (isAuthenticated && result === undefined),
  };
}
```

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
- **`useQuery(convexQuery(...))` via TanStack** — when React Query semantics help: `placeholderData: keepPreviousData` for search-as-you-type, `staleTime`/`gcTime` session caching (compare columns, pickers, explore).

### Pattern: `'use cache'` + `fetchQuery` server loaders (catalog routes)

```tsx
// components/skill-detail-page.tsx
export async function loadSkill(source: string, skillId: string) {
  "use cache";
  cacheLife("days");
  cacheTag("skill-sync");
  return fetchQuery(api.skills.getBySourceAndSkillId, { source, skillId });
}
```

The cache key is derived from the args. Shared across `generateMetadata` + page body + any other importer. Cross-user — one Convex call per skill per `cacheLife` window, total. `cacheTag("skill-sync")` lets the daily sync bust every skill page's data in lockstep via `/api/revalidate`. The cached result lands in the route's static shell.

> A considered-and-rejected extension: exposing `loadSkill` to the client via a GET route handler so compare/detail-sheet fetches share this cache. Rejected on plan economics (it trades Convex Pro calls for capped Vercel Hobby invocations) — see the note in `app/(main)/compare/compare-content.tsx`.

### Pattern: `preloadQuery` + `usePreloadedQuery` (bundle page only)

Server preloads with the user's token; the client hydrates the result into a live subscription:

```tsx
const [preloadedBundle, preloadedPlan] = await Promise.all([
  preloadQuery(api.bundles.getByUrlId, { urlId: id, shareToken: share }, { token }),
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

### Static route (home, explore, compare, dashboard, settings)

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
  use-debounced-cached-search.ts

convex/
  convex.config.ts          # registers @convex-dev/polar
  auth.config.ts            # Clerk JWT issuer
  http.ts                   # Clerk + Polar webhooks
  schema.ts / users.ts / bundles.ts / skills.ts / plans.ts / crons.ts

app/
  layout.tsx                # plain <html><body> — NO root Suspense
  providers.tsx             # NuqsAdapter → Clerk(prefetchUI:false) → Convex → Theme → Toast
  ConvexClientProvider.tsx  # ConvexProviderWithClerk + TanStack wiring
  api/revalidate/route.ts   # secret-gated tag revalidation (Convex crons call it)
  (main)/
    layout.tsx              # AppHeader + children + GlobalBundleBar
    page.tsx                # static; Suspense + HomeFallback (mirrored default state)
    home-fallback.tsx
    explore/                # static; Suspense + ExploreFallback
    compare/                # static; nuqs skills param, client columns, picker sheet
    dashboard/              # static; client useQuery + DashboardSkeleton gate
    settings/               # static; getSessions server action in actions.ts
    bundle/[id]/            # ◐ Partial Prerender; loading.tsx shell + preloadQuery + generateMetadata
    [org]/...  site/...     # ◐; gSP returns 1 representative param, 'use cache' loaders, loading.tsx shell

components/
  app-header.tsx            # server shell; client islands in Suspense
  header-auth-client.tsx    # fully client auth UI (keeps routes static)
  global-bundle-bar.tsx     # layout-mounted, pathname ALLOW-list
  bundle-bar.tsx            # deferred entrance (rAF×2) + @starting-style
  skill-detail-page.tsx     # loadSkill/loadAudits ('use cache' + cacheTag loaders)
  skill-picker.tsx          # shared picker pieces (bundle edit + compare)
  header-nav.tsx            # DesktopNav — usePathname read behind <Suspense>
  global-bundle-bar.tsx     # layout-mounted, pathname allow-list, <Suspense fallback={null}>

lib/
  representative-params.ts  # 1 representative param per catalog route for generateStaticParams

proxy.ts                    # Clerk middleware — PRIVATE-route list (inverted)
next.config.ts              # cacheComponents + partialPrefetching; optimizePackageImports
```
