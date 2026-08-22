# AGENTS.md

This file is the primary guidance for AI coding agents (Claude Code, Codex, etc.)
working in this repository. It is the single source of truth — `CLAUDE.md` just
imports this file.

## Project Overview

SkillBundle is a web app that helps developers discover, compare, and bundle AI coding assistant skills for their tech stack. Users select technologies, get matched with relevant skills from the skills.sh ecosystem, and save/share curated bundles with install commands. See SPEC.md for the full product specification.

## Roadmap & ideas

Things we want to build, ideas, and parked decisions live in [TODO.md](TODO.md).
Check it for planned work and deferred decisions, and add to it rather than letting
ideas get lost in chat.

## Commands

- `pnpm dev` — Start Next.js dev server
- `pnpm build` — Production build
- `pnpm lint` — Run ESLint
- `pnpm test` — Unit tests (vitest, `tests/**/*.test.ts` — Convex backend logic)
- `pnpm e2e` / `pnpm e2e:ui` — Playwright (`e2e/**/*.spec.ts`): instant-navigation,
  landmark and skill-history guards signed out, plus signed-in functional
  coverage in `e2e/authenticated/`
- `npx convex dev` — Start Convex dev server (runs alongside Next.js dev)
- `npx convex deploy` — Deploy Convex functions to production

Both `pnpm dev` and `npx convex dev` must be running during local development.

**`pnpm build` needs a reachable Convex deployment.** Every `generateStaticParams`
calls `fetchQuery` (via `lib/representative-params.ts`), and prerendering those
paths runs the `'use cache'` loaders. A fresh clone without `.env.local` cannot
build. The hardcoded fallbacks in `representative-params.ts` harden _param
selection_, not the render.

**Two test suites, deliberately non-overlapping.** `pnpm test` is vitest over
`tests/**/*.test.ts`; `pnpm e2e` is Playwright over `e2e/**/*.spec.ts`, against a
production build on port 3100. Don't put one kind of test in the other's
directory — the globs are what keep the runners apart. `pnpm check` is
format:check + lint + typecheck + unit tests; e2e is separate because it builds
the app.

**Formatting is gated, so run `pnpm format` before committing.** Prettier owns
every file except `components/ui/cubby-ui/`, which is vendored through
`shadcn add` and excluded in `.prettierignore` — formatting it would be
reverted by the next component update and break the gate on arrival.
`components/charts/` used to be excluded for the same reason; it is now our own
code (see Charts below) and is formatted like everything else.

**`shadcn add @cubby-ui/style` needs a manual pass over `app/globals.css`
afterwards, every time.** `app/globals.css` is NOT in `.prettierignore`, so the
installer's four-space output fails `format:check` — run `pnpm format`. It also
runs an update-theme pass that echoes every non-color variable back into
`@theme inline` as `--x: var(--x)`. Those are inert (a self-reference is a cycle,
and the real values live in the unlayered `:root` / `.dark` further down, which
outrank the theme layer either way) but they accumulate; delete them. Delete ONLY
exact self-references — `--color-x: var(--x)` entries are real aliases that
generate utilities, and `--color-chrome: var(--chrome)` in particular is what
makes `bg-chrome` work.

`.gitattributes` pins the working tree to LF and is load-bearing for that gate,
not housekeeping. `core.autocrlf=true` is the Windows default and rewrites files
as CRLF whenever git materialises them; Prettier's default `endOfLine: "lf"`
then rejects them. Which files are hit depends on which ones git last checked
out, so without the pin `pnpm check` passes or fails according to your recent
branch switches. If `format:check` ever fails on a file that looks correct,
check its line endings first.

## Tech Stack

- **Framework:** Next.js 16 (App Router) with React 19
- **Backend:** Convex (database, serverless functions, cron jobs)
- **Auth:** Clerk (JWT-based, synced to Convex via webhooks)
- **Styling:** Tailwind CSS v4 with OKLch color system
- **Package manager:** pnpm
- **UI components:** Custom library in `components/ui/cubby-ui/` built on Radix UI and Base UI primitives. Component docs available at https://www.cubby-ui.dev/llms.txt
- **Icons:** HugeIcons (primary) and Lucide React
- **Animations:** Motion library (motion) for UI; charts animate through
  TanStack Charts' own motion renderer (see Charts below)
- **Charts:** TanStack Charts (`@tanstack/charts`)

## Architecture

This is a high-level map. The detailed, authoritative guides are:

- **[docs/architecture.md](docs/architecture.md)** — frontend & platform: Next.js 16 static-first rendering + caching, the route inventory (static / ISR / dynamic), the Suspense-default-state pattern, Clerk auth wiring, the provider tree, data-fetching patterns, nuqs URL state, and Polar billing. **Read this before any frontend / rendering / caching / auth work.**
  Two rules from that guide that are easy to break without noticing, because
  **direct page loads keep working either way**:

- Catalog pages (`/[org]`, `/[org]/[repo]`, `/site/[source]`) must **not**
  `await params` above their `<Suspense>` boundaries. Doing so empties the
  route's shared App Shell and makes every client navigation into it blocking.
  Keep the page component synchronous and pass the `params` promise down.
- Error handling has three layers (`app/global-error.tsx`,
  `app/(main)/error.tsx`, `components/data-error-boundary.tsx`). Use the
  innermost one that fits rather than adding `try/catch` inside a Server
  Component — that swallows the error and loses `retry()`.
- **Restructuring a page means updating its `loading.tsx` / Suspense fallback in
  the same change.** Nothing catches that drift — the e2e guards assert a shell
  commits instantly, not that it resembles the page — and a stale fallback reads
  to users as the skeleton being replaced by a second, different skeleton rather
  than as a bug. See docs/architecture.md §2.
- **A section that's expensive on the client usually belongs on the server, not
  behind a deferral.** Deferring keeps the cost and adds a loading phase. Only
  genuinely per-interaction work (e.g. the shiki diff in
  `components/skill-history-row.tsx`) should stay lazy.

`e2e/instant-navigation.spec.ts` guards the first one. See docs/architecture.md
§1, §14 and §15.

- **[docs/skill-lifecycle.md](docs/skill-lifecycle.md)** — backend skill pipeline: how skills enter the catalog, the sync / reconcile / curated / duplicate-detection jobs, "seen" + delisting rules, snapshots, and the `needs*` work-set patterns. **Read this before touching the sync or skill-lifecycle code.**

### Frontend → backend

ClerkProvider wraps ConvexProviderWithClerk in the root layout (`app/layout.tsx`). Static-first: route shells prerender (CDN), and per-user/interactive data arrives over the authenticated Convex websocket via `useQuery`/`useMutation` (or `useQuery(convexQuery(...))` through TanStack Query). Auth is Clerk, bridged to Convex by JWT; the `proxy.ts` middleware uses an **inverted private-route list** (`/dashboard`, `/settings`, `/dev`) because the catch-all org routes shadow everything — see docs/architecture.md §3.

### Convex backend (`convex/`) at a glance

Tables (`schema.ts`), grouped by concern:

- **Skills catalog:** `skills` (full ~10 KB rows), `skillSummaries` (slim ~1.3 KB denormalized rows that lists/search/cards read), `skillEmbeddings` (vector search), `skillAudits` + `skillSnapshots` (security verdicts + install-count history), `syncStats`.
- **Sync / dedup support:** `curatedOwnerSummaries`, `githubTreeCache`, `githubRepoResolution`, `repoFingerprintCache`.
- **Version archive:** `skillVersions` (one row per detected SKILL.md change, raw file in `_storage`; `isBaseline` marks a starting point rather than an edit).
- **Users & bundles:** `users`, `bundles`. (`bundleStats` and `bundleStars` were removed — see the note at the end of `schema.ts`.)

Modules, grouped by concern:

- **Skill sync & lifecycle:** `skills.ts` (sync pipeline + catalog queries), `reconcile.ts`, `curated.ts` / `curatedRefresh.ts`, `duplicates.ts`, `audits.ts`, `crons.ts`, plus `lib/*` helpers (`detailRefresh`, `skillHealth`, `source`, `appDay`, `pagination`, `github`, `skillsApi`, `embeddings`). Documented in docs/skill-lifecycle.md.
- **Leaderboards & discovery:** `leaderboards.ts` (trending/hot), `recommendations.ts` (repo-fingerprint matching).
- **Version archive & monitoring:** `skillVersions.ts` (read + write API over the change archive; `freshness.ts` decides which SKILL.mds to re-check).
- **Bundles & social:** `bundles.ts`.
- **Users, auth & billing:** `users.ts`, `http.ts` (Clerk + Polar webhooks, Svix-validated), `auth.config.ts`, `subscriptions.ts` / `plans.ts` / `polar.ts` (+ `convex.config.ts` registers the `@convex-dev/polar` component).
- **Admin / dev:** `devStats.ts` (the `/dev` dashboard stats), `devSeed.ts`,
  `githubOnly.ts` (admin add of skills that exist only on GitHub, not on
  skills.sh — see docs/skill-lifecycle.md "GitHub-only skills"),
  `githubOnlyAudit.ts` (read-only diagnostic: GitHub-only rows whose stored
  slug disagrees with their SKILL.md's frontmatter name), `bindAudit.ts`
  (read-only diagnostic: is the RIGHT SKILL.md bound to each skill — a
  different question from `githubOnlyAudit.ts`), `devSeedFeed.ts` (dev-only
  seeding for the dashboard's change feed).

This list is "at a glance", not exhaustive — but every module and table it
NAMES should exist. It has twice pointed at files that had been deleted.

### Crons (`crons.ts`)

Daily sync chain (`syncSkills` 06:00 UTC → curated 06:30 → snapshot prune 06:45 → `reconcileUnseenSkills` 07:00, with the discovery/content/audit/embedding pipeline chained off the sync), hourly + 30-min leaderboard refreshes (trending / hot), daily cache cleanups, and a weekly Sunday duplicate chain (resolve repo identities 08:00 → curated refresh 09:00 → re-resolve stale identities 10:00). Production-only (gated by `CRONS_ENABLED`).

### Charts

Three charts, all built on **TanStack Charts** (`@tanstack/charts`): the sidebar
sparkline, the install-history dialog chart, and the compare page's multi-line
chart. Shared pieces live in `components/charts/`; each chart file owns its own
`defineChart` definition.

The library ships its own docs and skills inside the package —
`node_modules/@tanstack/charts/docs/` and `.../skills/`, indexed by `llms.txt`.
**Read those rather than relying on memory or a docs mirror**; they match the
installed version, and this is a young library that moves.

Things that are easy to get wrong, all of which were:

- **Charts are composed by spreading `chartHostProps` into `RendererChart`, not
  by a wrapper component.** A generic wrapper has to re-declare the datum and
  axis type parameters, and they collapse to `unknown` at the call site, which
  costs the typed `point.datum` in `renderTooltipBody` and `onFocusChange`.
- **`RendererChart` comes from `@tanstack/charts/react/tooltip`.** That is the
  only entry that takes both a `renderer` and `renderTooltipBody`.
- **Marks that should be read together at one x need distinct `z` values.**
  Grouped focus reduces points sharing a group to a single member, and the
  default group is `null` — so two ungrouped marks silently collapse to one,
  taking a tooltip row and the hover highlight with it. Guarded by
  `tests/highlight-segment.test.ts`.
- **`onFocusChange` fires on every committed prop set, not only when focus
  moves.** Feeding it straight into `setState` is an infinite render loop;
  compare against the last value first (see `skill-install-sparkline.tsx`).
- **A re-render of the chart's parent cancels any in-flight focus animation.**
  Every React commit re-pushes props to the chart host, which repaints and
  drops the running spring, so the focus dot jumps instead of travelling. Any
  state a chart feeds back into the page (the sparkline's hovered day) must not
  re-render the chart: keep its props referentially stable so the component
  bails out. `weekWindow()` returning a fresh slice each render was enough to
  break it.
- **`focusRing: false` on every definition.** The overlay draws the marker, so
  leaving the built-in ring on paints a second dot underneath it — and only
  ours moves, which reads as one marker lagging the other.
- **Scene units are not CSS pixels.** The chart lays its scene out in its own
  coordinate space and lets the viewBox scale it to the container, so in the
  dialog a scene x of 564 paints at 594px. Anything in the overlay's SVG
  inherits that viewBox and needs no conversion, but the date pill and the
  tooltip panel are HTML positioned in `left`/`top`, and reading scene units
  into those puts them further and further behind the cursor toward the right
  edge. `pxPerUnit` in the overlay converts; it is measured off the painted
  SVG, NOT derived from `scene.width`, which is the container measurement and a
  different number. Nothing catches this on the compare chart, where the two
  happen to coincide.
- **`resolvePointer` answers from anywhere in the element**, including the axis
  gutters — it does not know where the plot is. Without the bounds check in
  `inspect` the cursor and tooltip appear while the pointer is down among the
  tick labels, well below the chart.
- **Every marker looks the same** — a disc of the series colour inside a ring of
  the surface. There is no per-mark variant; a hollow ring for lines was tried
  and rejected.
- **The tooltip panel wears the tooltip component's `chrome` variant**
  (`bg-chrome` + `data-surface="chrome"`), not a surface tier. A series painted
  in a page tone disappears on it — the daily bars' neutral did — which is what
  `HoverMarker.swatch` exists for. The date pill is on the same surface, so the
  two read as one instrument; the old chart inverted the pill in dark
  (`dark:bg-zinc-100`) and this deliberately does not. Fill only on both —
  `--chrome-shadow` is the variant's opt-in edge, for a header bar rather than a
  label — except the pill keeps its own `shadow-lg`, which it needs because it
  sits on the plot.
- **Bar dimming is a mark state, not overlay work.** `BAR_UNFOCUSED_DIM`
  (`series-state.ts`) uses `when: { focus: "unmatched" }`, evaluated per datum,
  because bars are per-datum scene nodes. Lines are not — the whole path is one
  node — which is why their highlight goes through the overlay's cloned band
  instead. When checking this in the DOM, note that the focused bar has NO
  `opacity` attribute rather than `opacity="1"`.
- **The cursor is not the chart's.** Rule, dots, highlight band and date pill
  are all Motion, in `chart-hover-overlay.tsx`; the definitions set
  `focusRing: false` and declare no focus guides. `focusGuideX` markers do
  animate, but the whole guide path wedges under a fast pointer — scrubbing
  left and right leaves the rule and dots frozen where the scrub started, and
  they never recover. The tooltip keeps updating throughout, which is what
  makes it look like a rendering bug rather than a motion one.
- **`tooltip.offset` applies along the placement's primary axis.** `bottom-*`
  offsets vertically and leaves the panel horizontally flush with the cursor;
  `right`/`left` is what puts a gap beside it.
- **Entrance motion is ours, the rest is the library's.** The left-to-right
  wipe is a CSS animation on `.ts-chart__marks` (`.chart-reveal` in
  `globals.css`); `chartMotion` is built with `initial: false` so the two do not
  both play. Everything else — crosshair, focus dot, highlight band, tooltip
  travel — springs through `@tanstack/charts/motion`. If chart motion looks
  dead, check the two entries below before reaching for Motion: both look like
  "the renderer is not animating" and neither is.
- **The overlay owns the pointer gesture (`pointer: false` on every
  definition).** The chart's own handling is hover-shaped — focus on move,
  clear on leave — and touch has no leave: a tap paints focus that then sits
  there, and a drag gets claimed by the browser as a scroll. The overlay maps
  each input to what it means (a mouse inspects on hover, a finger only while
  it is down) via `interaction.resolvePointer` / `setControlledFocus`, and the
  wrapper carries `touch-action: pan-y` so horizontal drags are ours.
- **The tooltip is capped narrow rather than made to stop animating.** It
  animates _into_ its resolved position, so on a small chart, where the panel is
  nearly as wide as the plot, the intermediate frames used to land outside it —
  and with nothing containing them that widens the document and flicks a
  horizontal scrollbar mid-drag. `maxWidth: min(16rem, calc(50vw - 3.5rem))`
  keeps both the resting and the travelled position inside, so motion stays on
  everywhere, touch included. Do not "fix" the overhang by centring the tooltip:
  following the cursor is the point, and hanging past the plot edge is fine.
- **The tooltip panel is ours too, in the overlay.** The built-in one clamps
  itself into the chart box, so where it does not fit beside the cursor it
  slides back over the marker it is describing — and that clamping cannot be
  turned off. Ours uses the old rule: `x + offset`, flipping to
  `x - offset - width` only when that would run past the chart, never anything
  between. It hangs off the edge rather than covering the point.
- **Do not signal overlay repaints through a MotionValue event.**
  `useMotionValueEvent` keeps whichever callback was registered on mount, so a
  listener reading refs runs a focus change behind and the panel shows the
  previous day. `showFocus` writes the panel's nodes inline instead; the panel
  registers them on the controller. Same trap applies to anything else a
  listener closes over — the compare page's series list grows as data loads.
- **Pass `initialWidth`.** The adapter renders its first markup at that width
  (default 640) and measures the container only after commit, so everything in
  scene units — stroke widths, marker radii, fixed margins — is scaled by the
  ratio until it re-lays-out. A 240px sparkline drawn first at 640 paints a
  hairline, then visibly thickens. `INITIAL_WIDTH` in `charts/chart.tsx`.
- **The chart SVG carries `tabindex="0"`, and Chrome treats a click on it as
  focus-visible.** The browser ring around the whole plot is suppressed in
  `globals.css`; the chart paints its own, far more precise focus state (rule,
  marker, tooltip), so this costs no accessibility.
- **The chart strips inline styles off its own nodes when it repaints**, and it
  repaints on every focus change. The node object survives, its `style` does
  not, so anything the overlay writes onto a tick label lasts about a frame.
  Two things it does NOT rewrite: a stylesheet rule, and a custom property
  inherited from an ancestor it does not own. The date-label fade uses both —
  one generated rule per label binding it to a `--tick-N`, and the numbers set
  on our wrapper as the pill moves (`paintTickFade`), reproducing the old
  chart's ramp: hidden within 10px of the pill's edge, back to full over the
  next 20px. That clearance is not cosmetic — the old chart hid everything
  within a flat 50px of the crosshair, and fading on centre distance alone
  leaves half a glyph poking out from behind the pill.
  Covering the labels with a strip of surface colour was tried instead and
  reads as a blank bar sweeping the axis; so does standing the whole row down,
  which the old chart did not do either.
- **Mark states cannot animate from an absent attribute.** A state that sets
  only the dimmed value leaves the focused node with no attribute at all, so
  the renderer has no `from` to tween: the dim lands in one frame and the
  transition is silently ignored, which reads as transitions being unsupported.
  Give the mark the same channel at full strength (`fillOpacity: 1`,
  `strokeOpacity: 1`) and write the state in that channel rather than
  `opacity`. Measured: 119ms for a 120ms tween once both ends exist.
- **`onRender` runs before the markup it describes is in the DOM.** Anything
  reading the rendered axis — the tick geometry the fade needs — has to wait a
  frame or it measures the PREVIOUS render. Only bites where data arrives late:
  the compare page laid out its labels on a pass nothing re-measured, so its
  labels never faded while the dialog chart's did.
- **Do not measure chart geometry with `getBoundingClientRect` during an
  entrance.** It is screen space, so it carries any transform an ancestor is
  mid-animation on: taken while the dialog was still scaling open, every tick
  centre came out ~20px adrift and the wrong label faded. The label's own `x`
  times `pxPerUnit` is transform-proof, and so is `clientWidth`.
- **Above 60 points the cursor stops animating** (`DISCRETE_THRESHOLD`, the old
  chart's `discreteInteraction`): the ticker swaps its label instead of
  scrolling and the rule, dots, band, pill and panel all jump. At that density
  the points are a pixel or two apart, so a spring has nothing to travel and
  gets retargeted on the way.
- **A Motion spring configured `{ duration: 0, bounce: 0 }` still animates.**
  It reads like "settle immediately" and does not: measured under
  `prefers-reduced-motion: reduce`, the focus dot travelled four intermediate
  positions. Instantaneity is decided per write with `jump()` instead, which is
  why the overlay has both `write` and `writePill` — the pill also jumps on
  touch, where easing under the finger reads as lag rather than motion.
- **The marker ring is the page tone (`--background`), not the tier the chart
  sits on.** It is a halo holding the dot off the line, so it has to contrast
  with the surface, not match it: handed the dialog's own `--surface-5` it
  vanished into it in dark. The old chart used `--chart-background` — white in
  light, near-black in dark — for the same reason.
- **The overlay writes only to MotionValues, never React state.** Putting any
  of it in state would re-render the chart on every pointer move and cancel its
  motion. Same reason the axis-label fade is an imperative write of custom
  properties, off geometry measured once per render: reading a box between
  style writes forces a reflow, and doing that per frame blows the frame budget
  on its own.
- **Grid stroke style is CSS, not definition.** `grid` is a boolean and the
  theme carries only a color, so the dash pattern and the opacity reset live in
  `globals.css`. The reset matters: the renderer draws grid rules at
  `stroke-opacity: 0.11` over a `--border` that is itself ~10% opaque, and the
  two multiply out to invisible.
- **A `scale:` factory infers its domain; only a configured _instance_ keeps
  one.** `scale: () => scaleLinear().domain([0, max])` silently loses the zero —
  the arrow makes it a factory. Pass `scale: scaleLinear().domain([0, max])`.
- **Give a cumulative y axis an explicit zero-based domain.** Left to infer,
  the scale starts near the smallest series and exaggerates the gaps between
  them. The old chart used `[0, max * 1.1]`; `compare-trend-chart.tsx` restates
  it. This is also why the sidebar sparkline plots `installs - min` rather than
  the raw total — against a zero-based axis a cumulative count is a flat line.
- **Date axes thin by `tickLabels.thin.minGap`.** Point and band scales offer
  every category as a candidate and ignore `count`/`spacing` hints, so left
  alone they print one label per row that fits — nearly twice the old chart's
  `numTicks`. `evenlySpaced` picks the candidates instead (5 in the dialog, 6 on
  the compare page); thinning still runs on top, which is what keeps a phone
  from crowding.
- **`ticks.count` is a preference d3 rounds, not a count.** On the dialog
  chart's domain, 5 asks yields 8 grid rules and 3 yields 5. Where the numbers
  are never read — the install chart's y axis describes neither series on its
  own — pin the domain and pass explicit `values`, which is exact and stable
  across data.
- **Bars take 80% of their band (`padding(0.2)`)**, the old chart's `barGap`.
  0.35 is visibly thinner and on a long series reads as a different chart.
- **Do not call `setControlledFocus` when focus has not moved.** It repaints the
  whole scene and restarts every mark-state transition, so calling it per
  pointer move retargets the bars' 120ms fade every frame: the fade never runs
  and reads as though it has none. Everything the overlay draws is anchored to
  the focused point rather than the pointer, so a move within one column has
  nothing to redraw anyway.
- **The date pill hangs past the plot at both ends and nothing may clip it.**
  It stays centred on its column all the way across, as the old chart's did;
  clamping it inside decouples it from the mark it is labelling exactly where
  that mark is easiest to point at. What keeps the overhang from widening the
  page is the dialog and the card clipping their own overflow — verify at phone
  width when touching this, since an overhanging absolute child otherwise
  flicks a horizontal scrollbar mid-drag.

`components/charts/chart-hover-overlay.tsx` is the only place that reaches into
the chart's rendered DOM (for the line's `d`, and to fade the axis labels the
date pill covers). That is real coupling to the library's output; it is
deliberate, because rebuilding the curve would not trace it exactly.

### Technology tagging

Not implemented. An earlier design (auto-tagging during sync + a frontend
technology registry) was never built; `components/skill-card.tsx` exposes an
optional `technologies` prop that nothing currently populates. If you're
asked to add technology tagging, treat it as new work, not a refactor.

## Conventions

- **Path alias:** `@/*` maps to project root
- **Class names:** Use `cn()` from `lib/utils.ts` (clsx + tailwind-merge)
- **Component variants:** Use `class-variance-authority` (cva)
- **UI components config:** See `components.json` for shadcn/ui style ("new-york"), icon library, and path aliases
- **Convex functions:** Use `v` validator from `convex/values` for all argument/return validation
- **One-shot repairs and backfills** (hand-run once via `npx convex run`, then
  dead) go in their own `convex/<name>Repair.ts`, with a DELETE-ON-COMPLETION
  header naming the commands and the exit condition, and a `TODO.md` entry that
  owns the deletion. Not inline in the module they repair. Reason, from Aug
  2026: a one-shot documented only in its own header was cloned into a
  near-duplicate the next day (`6e12f16` → `dcb61f5`) because nothing outside
  the file recorded that it existed. `skills.ts` still carries several that
  pre-date this rule (`backfillIsDelistedFalse`, `backfillLastSeenInApi`,
  `backfillNeedsRepoResolution`, `backfillArchiveBaselines`) — don't add
  another. Their presence is the argument for the rule, not an exception to it:
  none is called by anything, and what records that each is finished is
  scattered — a schema comment for two (`schema.ts`), a migration note for the
  same two (`docs/skill-lifecycle.md`), a `TODO.md` entry plus `freshness.ts`
  prose for `backfillArchiveBaselines`, and nothing at all outside its own file
  for `backfillNeedsRepoResolution`. No single place says which are retirable,
  which is exactly what the rule above fixes.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
