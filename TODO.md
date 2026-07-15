# TODO

A running list of things to build, ideas, and parked decisions — so they don't get
lost in chat. Not a committed roadmap; a scratchpad. Move items to a "Done" note or
delete them when shipped. Newest thinking near the top.

## Under consideration

### Match repo: deferred features (recents, match counts, GitHub OAuth)

Shipped (Jul 2026): repo mode morphs the composer card in place — the composer
is a single input row + chin (no separate control row anymore; filter toggles
sit inside the input, sort lives in the chin), Analyze inline in the input row
(URL-bar pattern), chin persists with the mode switch in its right corner
("Match repo →" enters, "← Search skills" exits), repo-shaped query
carry-over, Esc-to-exit, and repo-result narrowing (Official toggle +
Best match / Most installed).

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

Small parked idea (Jul 2026): analyzeRepo already returns `matchedPackages`
per recommendation group (lexical package overlaps) but nothing renders it —
per-row "matches react" notes were tried and cut as noise. Its natural home
is the skill detail sheet, where a clicked row has room to explain "why this
matched your repo" properly.

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
