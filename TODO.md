# TODO

A running list of things to build, ideas, and parked decisions — so they don't get
lost in chat. Not a committed roadmap; a scratchpad. Move items to a "Done" note or
delete them when shipped. Newest thinking near the top.

## Under consideration

### Search & discovery overhaul

- **Move search to a faceted engine (Typesense / Meilisearch / Algolia).** The current
  Convex full-text search is single-field + prefix, no typo tolerance. A faceted engine
  would give typo tolerance, multi-field ranking, and — the bigger win — one query layer
  that powers **both** search and browse.
- **Add filters + sorting to results** (e.g. technology, curated/official, install count).
- **Decide: do filters/sorting also apply to the browse views (Popular / Trending / Hot),
  not just search?** Leaning yes — filters that vanish when you stop searching is a
  confusing UX, and "filter + sort the whole catalog" is exactly what a faceted engine is
  for (and what Convex is weakest at). This decision drives the infra decision below.
- **Open cost/infra question:** a faceted engine means a Convex→engine **sync pipeline**
  (a second store to keep current as the catalog churns daily) plus **hosting cost**. We're
  on Vercel Hobby + Convex Pro and deliberately avoid extra paid services — weigh that
  against pushing Convex's own search further if the only real pain is typo tolerance.

### Home-list chips

- **Reconsider the row-level chips** as part of a list redesign.
  - The **"install may fail"** (fetch-warning) chip has real protective value — it warns
    before a user copies a broken install command. Lean: keep (restyle is fine).
  - The **"N copies" / shared-content** chip is informational and the easiest to cut from
    dense rows. Lean: remove from rows, keep only on the detail page.

## Parked decisions (context lives elsewhere)

- **Fast-delete for dead-but-installable skills ("Fix 2")** — deferred. Full context in
  `docs/skill-lifecycle.md` ("Dead-but-installable skills & the Fix 2 decision") and the
  `/dev` "Dead but installable" stat card. Only revisit if that count climbs.
