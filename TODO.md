# TODO

A running list of things to build, ideas, and parked decisions — so they don't get
lost in chat. Not a committed roadmap; a scratchpad. Move items to a "Done" note or
delete them when shipped. Newest thinking near the top.

## Under consideration

### Match repo: deferred features (recents, match counts, GitHub OAuth)

Shipped (Jul 2026): repo mode morphs the composer card in place — control row
collapses via animated height, Analyze inline in the input row (URL-bar
pattern), chin persists with the mode switch in its right corner ("Match my
repo →" enters, "← Search skills" exits), repo-shaped query carry-over,
Esc-to-exit (Paper artboard "H — Match repo morph", STATE 2B + follow-ups).

Still to build, independent of container:

- **RECENT** list of previously analyzed repos with match counts
  (e.g. `joncoronel/skillbundle · 42 matches`).
- **"Connect GitHub for private repos"** (OAuth).
- Free users see the recents area replaced by the Pro upsell.

Container decision, updated Jul 2026: the original vision (Paper artboard "F")
put these in a **popover on the button** — but that was designed when repo mode
was a clunky separate toolbar worth avoiding. Now that the mode is a pleasant
in-place morph, the current lean is to build them **inside repo mode**: the
repo empty state under the input is the natural home for RECENT + Connect
GitHub (replacing the single example button). The popover only earns its keep
if we ever want repo-as-chip **composing with** search (filters/sort applying
to repo matches at the same time, `⚡ skillbundle ✕` chip) — treat that as a
separate product question, not the default plan.

Why deferred: needs backend that doesn't exist yet — per-user history of
analyzed repos, stored match counts per repo, and GitHub OAuth.

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
