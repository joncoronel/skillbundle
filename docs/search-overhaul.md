# Search & discovery overhaul — planning doc

Living checklist for reworking search onto a faceted engine (Typesense). Tracks
**what we could add**, grounded in (a) the fields we actually have on
`skillSummaries` and (b) what Typesense supports. Not a committed roadmap — a menu
+ running decisions. Check items off as they ship; move settled questions out of
"Open decisions."

Related: [TODO.md](../TODO.md) (the original "Search & discovery overhaul" note),
[SPEC.md](../SPEC.md) ("Under consideration"), [docs/architecture.md](architecture.md)
(rendering/caching + the "push load off Vercel" constraint),
[docs/skill-lifecycle.md](skill-lifecycle.md) (the daily sync a Typesense sync would hang off).

## Status

- **Phase:** SHIPPED (v1, dev). Engine committed: **Typesense v29 self-hosted on
  Railway** (persistent volume), queried **browser-direct with a search-only key**.
- **Backend:** `convex/lib/typesense.ts` + `convex/typesense.ts` — daily
  mark-and-sweep `syncCatalog`, chained off `reconcileUnseenSkills`' completion
  (not a wall-clock cron) and guarded by a run lock so overlapping walks can't
  cross-stamp and sweep live docs; full catalog mirrored (~15.5k non-delisted
  docs). Dev collection `skills_dev` (TYPESENSE_COLLECTION is required outside
  prod); prod uses `skills`. **Prod backend is set up:** prod Convex has
  TYPESENSE_HOST / _ADMIN_API_KEY / CRONS_ENABLED (so the collection defaults to
  `skills`), and the `skills` collection exists and is populated + kept fresh by
  the daily cron. **The remaining merge gate is the FRONTEND env:** the browser
  client needs `NEXT_PUBLIC_TYPESENSE_HOST` / `_SEARCH_KEY` / `_COLLECTION` set
  in Vercel for Production AND Preview. Preview builds run `NODE_ENV=production`
  and the deployed code searches Typesense, so if those vars are missing the
  client throws and search errors — set them before/with the merge.
- **Frontend:** `lib/search/typesense.ts` (browser client) +
  `hooks/use-catalog-search.ts` + the two-state home surface
  (`components/skill-explorer.tsx`). **Hybrid wiring chosen** (option 1 below):
  default entry state stays on the cached Convex Popular page; any
  query/filter/sort activates Typesense.

---

## Committed plan (2026-07)

Prioritized after a Typesense v29 feature review (Context7). Tiers by value/effort.

**Tier 1 — building now**

1. **`_eval` trust tie-breaker** (ranking quality, zero backfill). Append a
   weighted `_eval` to the *query* sort chain so equally-relevant matches order
   by trust: `sort_by = _text_match:desc,
   _eval([(isOfficial:true):2,(worstAuditStatus:pass):1]):desc, installs:desc`.
   Non-destructive (only breaks ties that were already arbitrary), encodes the
   product's trust story, no UI. Query path only (browse `installs:desc` rarely
   ties). · TS: `_eval` weighted sort
2. **Match highlighting** (perceived quality, zero backfill). Render the spans
   Typesense already returns. · TS: `highlight_full_fields`
3. **Publisher / repo filter** (the missing high-value filter). Add a derived
   **`owner`** field (`source.split("/")[0]`) to the collection + sync mapping,
   facet on it, and add a **searchable combobox** pill ("Publisher") with
   typeahead + counts. Owner-level (`owner:=vercel-labs`) plus exact repo via
   `source`. Needs a collection schema bump + resync (derived field only, no new
   data source). · field: `owner` (new, derived) · TS: `facet_by` + filter

**Tier 1b — next pass (needs new denormalized fields on `skillSummaries` +
the daily cron), then the sort options light up:**

4. **Recently updated** sort — mirror `contentUpdatedAt` (on the heavy `skills`
   row) onto the summary via the content-fetch path + a backfill, then sync it.
5. **Rising / momentum** sort — a daily job computing 7d install gain from
   `skillSnapshots` onto the summary, then sync `momentum7d`. The standout sort:
   per-skill, so it composes with search unlike Trending/Hot.
   > Decided: default = **absolute** 7d gain; a `%`-growth "breakout" variant
   > (with an install floor) is a later flavor, not v1.

**Tier 2 — after Tier 1**

6. **Hybrid / semantic search** via a **built-in embedding model**
   (`ts/all-MiniLM-L12-v2`, auto-embed from `name,description`), so the query is
   embedded *inside* Typesense and search stays browser-direct (no Convex
   round-trip). Chosen over reusing our 512-dim `skillEmbeddings`, which would
   force a server call to embed the query text. · TS: rank fusion (`query_by`
   incl. embedding)
7. **Synonyms** — small curated list (`nextjs`↔`next.js`, `k8s`↔`kubernetes`,
   `postgres`↔`postgresql`, `ai`↔`artificial intelligence`). · TS: global synonyms

**Tier 3 — later:** grouping (collapse dupes), install-range facet buckets,
curation/pinning, federated skills+bundles (`multi_search`), and search
analytics (`popular_queries` / no-hits → "popular searches" + gap reports).

**On the cubby `Filters` component:** evaluated, **not adopting wholesale.** Its
operator machinery (`is`/`is not`/`contains`/`between`) is dead weight for a
catalog of quick toggles, and it changes the composer aesthetic. Keep the lean
scoped-select bar; add Publisher as one searchable combobox. Revisit only if the
filter set goes broad (publisher + tech tags + buckets + date ranges).

---

## The model we're designing around

Two **different kinds** of surface — don't conflate them:

1. **Zeitgeist rails — Trending / Hot.** Time-windowed *subsets* (only ~60 / ~30
   skills carry `trendingRank` / `hotRank`; everyone else is `undefined`). These
   are **browse-only discovery lenses**, not sorts. They do **not** compose with
   search or filters — "search 'tailwind' sorted by trending" is near-empty by
   construction. Keep them as their own rails.
2. **The searchable catalog.** The full list that **search + filters + sorting**
   operate on. Every sort/filter here must be a per-skill *value that exists on
   every row* (like `installs`), so it survives search + filtering.

**Decision (leaning):** filters + sorting apply to the **whole catalog**, always —
not only while searching. Search is just a text query that narrows the catalog and
flips the default sort to Relevance. Filters/sort controls stay put whether the
query box is empty or not.

### What "the catalog" means, concretely (NOT decided — thinking)

"The catalog" = **the full set of non-delisted skills** — which is exactly the set
the current **Popular list already walks** (`by_isDelisted_installs`). Popular isn't
a separate dataset; it's the catalog sorted by installs. So the searchable catalog
is the **generalized Popular list**: one list with a **sort selector** (default =
installs, i.e. "Popular"), **filters**, and an optional **query**. Trending / Hot
are untouched — separate rails, separate queries, not part of this list.

**Data path — how this coexists with today's cached list + infinite scroll:** the
app already does the needed move. Today, `getInitialPopularSkills()` (`'use cache'`,
`cacheTag: home-popular`) SSRs the first page into the static shell, `PopularList`
adds infinite scroll, and the moment a user types, the `Crossfade` swaps to a live
client-side `searchSkills` query. Filters + sort just extend that same swap:

| State | Data path |
| --- | --- |
| Default (no query, no filters, sort = Popular) | Cached SSR first page + infinite scroll — **as today** |
| Any active filter / non-default sort / query | Live paginated query (cache doesn't apply, doesn't need to) |

The cached first page only ever serves the one default landing view (the view most
visitors see first, and the only one that's cacheable — every filter/sort/query
combo is a different result set). Infinite scroll survives on Typesense via
`page`/`per_page`. Two wiring options, **undecided**:

1. **Hybrid** — cached default Popular page stays on **Convex** (as now); switch to
   **Typesense** only when a filter/sort/query is active. Least change; two sources
   for "the same list" so row shapes must match.
2. **All-Typesense** — the catalog list is one Typesense-backed source; the default
   state is just a special case wrapped in `'use cache'` for SSR. One row shape, one
   code path. Cleaner long-term (one query layer for browse + search), more upfront work.

---

## What we could add

Legend: **field** = backing data on `skillSummaries` (or noted table) ·
**TS** = Typesense feature · `[ ]` todo `[~]` in progress `[x]` done

### 1. Search quality (the core upgrade)

- [x] **Search `description`, not just `name`** — now an **opt-in** ("Search
      descriptions" in More; default is names-only for tighter matches). Names
      only ≈ 15× fewer hits than +descriptions (e.g. "database": 21 vs 313), so
      it's a precision-vs-recall toggle. · `query_by: name` / `name,description`
- [x] **Weighted multi-field ranking** (name > description, when descriptions
      are on). · `query_by_weights: 3,1`
- [x] **Typo tolerance** ("tailwnid" → "Tailwind"). · TS default (`num_typos`);
      verified: "postgress" → 117 results
- [x] **Honest fallback under filters** — Typesense escalates to typo matching
      when the *filtered* exact set is empty, so a real word whose matches are
      all filtered out got silently swapped for edit-distance neighbors
      ("hero" + Official → "zero" skills, a broken filter contract). Page-1
      narrowed query searches now ride two count-only exact probes (`num_typos:
      0`, `per_page: 0` — one narrowed, one baseline) in the same request via
      `multi_search`; "exacts exist baseline, zero narrowed" ⇒
      `hiddenByFilters`, and the UI renders a filtered-to-empty state with a
      one-click un-narrow instead of the fabricated hits. Genuine typos
      ("naxt") have no exacts to hide, so correction still works under
      filters. · `lib/search/typesense.ts` (`hiddenByFilters`),
      `catalog-results.tsx` (`NarrowedToEmptyState`)
- [x] **Prefix / search-as-you-type** · TS default
- [ ] **Highlighting** matched terms in results. · TS: `highlight_full_fields`
      (rows don't render highlights yet)
- [ ] **Hybrid / semantic search** — reuse the existing 512-dim `skillEmbeddings`
      so "auth" surfaces Clerk / better-auth without a literal match. Already doing
      vector search for repo analysis; this reuses it for the search box. · field:
      `skillEmbeddings` (separate table) · TS: `vector_query` + rank fusion (`alpha`)
      (vectors are NOT in the Typesense collection yet)

### 2. Filters — every one maps to a field we already denormalize

- [x] **Official / curated only** · "All skills / Official only" select
      (`?official=true`), facet count in the item
- [x] **Audit status** — "Any audit / Passed audit / No failed audits" select
      (`?audit=pass|nofail`). **Our differentiator.** `pass` = only clean audits;
      `nofail` = `worstAuditStatus:!=fail` (keeps warns + unaudited, drops the
      ~1,900 failures). Works because the sync defaults missing
      `worstAuditStatus` to `"unknown"` (Typesense skips docs missing a filtered
      field).
- [x] **Minimum installs** — radio under "More" (Any / 100+ / 1k+ / 10k+,
      `?min=<n>`). Demoted from a top-level select: popularity is already the
      default sort, so a hard threshold is secondary. Presets (not a slider —
      unusable over a 0–1.5M exponential range).
- [~] **Hide forks / copies** — kept as a hardcoded default (`isDuplicate:false`)
      but the **user toggle was removed**: `isDuplicate` is `false` on 100% of
      the catalog (skills.sh doesn't set it), so a control did nothing. A real
      "hide duplicates" would wire to our own `copyCount`/repo-identity detection
      (the signal that's actually populated) — deferred.
- [x] **Exclude broken installs** — "Hide broken installs" under More
      (`?broken=true` → `hasContentFetchError:false`)
- [x] **Clear (n)** — one-tap reset of all filters to their broad defaults
- [ ] **By owner** (filter the catalog to one publisher). · supported by
      `lib/search/typesense.ts` (`source`) — no UI yet

**Control pattern:** only the two differentiators (Official, Audit) are visible
as scoped selects defaulting to their broadest value, so active narrowing shows
in the closed trigger. Secondary hygiene filters (min installs, forks, broken)
live under "More" (+n badge in the button's `rightSection`) to keep the bar
from sprawling. Chosen over a single checkbox menu (checked state invisible when
closed) and over a full row of selects (too many, mostly reading "Any X").

> Note: there is **no** `technologies`/tags field anymore (tech-stack filtering was
> dropped). So no "filter by technology" facet unless we reintroduce tagging.

### 3. Sorts — must be per-skill values (exist on every row)

- [x] **Relevance** (default when a query is present). · TS: `_text_match`
- [x] **Most installed** (all-time — today's "Popular"; default with no query). ·
      field: `installs` · TS: `sort_by: installs:desc`
- [ ] **Recently updated** · field: `contentUpdatedAt` (on `skills`; mirror to summary if needed) · TS: `sort_by`
- [ ] **Rising / momentum** — install *gain* over 7/30 days, computed from
      `skillSnapshots`. A real whole-catalog sort (every skill has it), so it
      composes with search where Trending/Hot can't. Absolute gain = safe default;
      percentage growth (with an install floor) = a spicier "breakout" variant. ·
      field: derive from `skillSnapshots` → new mirrored field on summary · TS: `sort_by`
- [ ] **Name A–Z** (minor, but cheap). · field: `name` · TS: `sort_by`

> **Trending / Hot are NOT in this list on purpose** — they're subset ranks
> (`trendingRank`/`hotRank`), not catalog-wide sorts. They stay as browse rails.

### 4. Facet counts (the thing Convex structurally can't do cheaply)

- [x] **Counts next to filters** — live counts on the Filters dropdown items
      (Official / Audit passed), from the same query. · TS: `facet_by` + counts
- [ ] **Numeric range facets / buckets** — e.g. install-count buckets. · TS:
      `facet_by: installs(0:[0,100], ...)`
- [ ] **Per-owner counts** on `/official`. · field: `curatedOwner` · TS: `facet_by`

### 5. Typesense advanced features — could adopt later

- [ ] **Grouping** — collapse near-duplicate skills (complements duplicate
      detection). · field: `githubRepoId` / `syncHash` · TS: `group_by`
- [ ] **Synonyms** — "ai" ↔ "artificial intelligence", "nextjs" ↔ "next.js".
      Global, shareable. · TS: global synonyms
- [ ] **Curation / pinning (merchandising)** — pin a featured skill for a given
      query. · TS: global curation rules (`pinned_hits`)
- [ ] **Diversify results (MMR)** — avoid five near-identical skills dominating the
      top. · TS: `facet_sample` / MMR diversify (v30.2)
- [ ] **Federated / multi-search** — one query box returning skills *and* bundles,
      ranked together. · field: separate `bundles` collection · TS: `multi_search` / JOINs
- [~] **Scoped search keys** — a plain **search-only** key is live
      (browser-direct, off Vercel functions). Not yet *scoped* with an embedded
      `filter_by` — delisted rows are excluded by the sync instead (never
      indexed), so nothing sensitive is exposed. · TS: scoped API keys

---

## What Convex can do *now* (no new infra) vs. what forces Typesense

**Do on Convex today (cheap wins, worth doing regardless of the engine decision):**

- Add `description` to the search field (kills the name-only gap).
- Add `worstAuditStatus`, `isDuplicate`, `hasContentFetchError` as `filterFields`
  on the `skillSummaries` search index → ship the "Verified safe" filter now.
- Popular sort already exists via `by_isDelisted_installs`.

**Forces the faceted engine (Typesense):**

- **Facet counts** — Convex won't give "Passed audit (12,301)" without scans.
- **Sorting combined with a text query** — Convex full-text returns by relevance
  only; you can't say "search 'auth' AND sort by installs." This alone breaks the
  unified-catalog model.
- **Typo tolerance + weighted multi-field ranking.**
- **One layer for search AND browse AND filter AND sort.**

---

## Infra / sync notes

- **Sync pipeline:** mirror `skillSummaries` → a Typesense `skills` collection off
  the daily cron chain (see skill-lifecycle.md). Schema maps ~1:1 to the fields
  above. Delisted rows excluded (or filtered via scoped key).
- **Query path:** browser-direct via scoped search-only keys → query + results
  never touch Vercel functions (the Hobby-plan concern). Keeps this off the
  "push load toward Convex, not Vercel" ledger entirely.
- **Cost:** Railway self-host (~$5–10/mo, persistent volume) or Typesense Cloud.
  Catalog is small, so a single small node is plenty for a long time.

---

## Open decisions

- [ ] **Engine:** Typesense vs. push Convex search further? (Leaning Typesense for
      facet counts + search-with-sort; those are the hard blockers.)
- [ ] **Include Rising/momentum as a catalog sort,** or keep catalog sorts to
      Relevance / Most installed / Recently updated and leave momentum out of scope?
- [ ] **Rising flavor:** absolute install gain (default) vs. percentage growth
      (with an install floor) — or offer both?
- [ ] **Home-page IA:** how to arrange the two surfaces (Trending/Hot rails vs. the
      searchable catalog) + the repo-analysis entry. (Being shaped separately.)
- [ ] **Federated skills + bundles search** — worth it, or keep bundle search on
      its own `/explore`?
- [ ] **Host:** Railway self-host vs. Typesense Cloud.
