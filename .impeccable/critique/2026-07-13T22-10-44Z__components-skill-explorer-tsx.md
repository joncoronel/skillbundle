---
target: home composer (search + repo modes)
total_score: 28
p0_count: 0
p1_count: 2
timestamp: 2026-07-13T22-10-44Z
slug: components-skill-explorer-tsx
---
# Critique: home composer (search + repo modes)

Method: dual-agent (A: design review · B: detector/browser evidence)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Sort silently auto-swaps to "Relevance" in a row the user isn't looking at |
| 2 | Match System / Real World | 3 | "No failed audits" vs "Passed audit" is insider jargon |
| 3 | User Control and Freedom | 3 | Desktop Clear deliberately excludes Official — defensible but surprising |
| 4 | Consistency and Standards | 3 | Official/scope controls change home and Clear semantics between desktop and mobile |
| 5 | Error Prevention | 2 | Analyze accepts any non-empty string; invalid value enters the shareable URL |
| 6 | Recognition Rather Than Recall | 2 | Two icon-only toggles require tooltip hover to learn; repo results never say why a skill matched |
| 7 | Flexibility and Efficiency | 4 | "/" focus, Enter/Esc, deep links, instant cached re-analysis, example repo |
| 8 | Aesthetic and Minimalist Design | 3 | 46px control row hosting three 32px controls is the card's weakest real estate |
| 9 | Error Recovery | 2 | "Invalid GitHub URL" is a bare red line in a void — no hint, no example, no role=alert |
| 10 | Help and Documentation | 3 | Nothing explains audit semantics anywhere |
| **Total** | | **28/40** | **Good — solid foundation, weak spots concentrated in repo-mode trust/error paths** |

## Anti-Patterns Verdict

Not AI-generated-looking. Ranked-table density with tabular numerals, one blue accent used sparingly, the pixel display font, and the unusual two-layer instrument+chin card read as designed. Deterministic CLI scan: 0 findings across all three files. Browser overlay flagged 3 items, all judged false positives on inspection: "nested-cards" (the inset Card + inner InputGroup surface is the deliberate composer anatomy, not a Card-in-Card), "layout-transition: height" (the intentional collapse mechanic, small contained region), "clipped-overflow-container" (decorative fixed background layer). The one stock pattern: the repo empty state (dashed border + centered icon + CTA) — generic but appropriate.

## Overall Impression

The composer is a genuinely designed instrument with honest states and a disciplined mode morph. Its weakness is asymmetric: search mode is polished and trustworthy; repo mode delivers its "wow" (instant analysis, example repo) and then goes quiet exactly when the user needs trust and control — 60 unexplained matches, no narrowing, curt error handling.

## What's Working

1. Honest loading states: the cache-aware derived spinner never lies; the analysis skeleton mirrors the final layout so nothing shifts.
2. Mode-morph discipline: focus survives the switch, Esc backs out, →/← grammar in one stable corner, URL round-trips state, inert removes collapsed controls from tab order.
3. Distinct identity in both themes: ranked rows, tabular numerals, one accent; light mode holds without rework.

## Priority Issues

1. **[P1] Repo results are a dead end for narrowing.** All controls collapse, then 60 recommendations arrive with no official-only, no audit filter, no sort — the flow that most needs trust signals has the fewest. Fix: minimal result-header controls (official toggle + sort) or trust-ranked default ordering. Suggested: $impeccable shape.
2. **[P1] No match reasons.** Nothing says why `ui-styling` matched shadcn-ui/ui; detected-stack chips are a noisy wall (+166) and unranked. Fix: per-row "matched: tailwindcss" chip; rank and cap the chips (~8). Suggested: $impeccable shape.
3. **[P2] Official — the flagship filter — is an unlabeled 32px glyph.** Recall-dependent iconography with a subtle pressed state, while "Official" is a nav item and a per-row badge. Fix: labeled pill or move to chin with text. Suggested: $impeccable clarify.
4. **[P2] Repo error prevention + recovery.** Validate with the repo-shape regex that already exists in enterRepoMode before submit; render errors inside the empty-state card with a format example and role=alert. Suggested: $impeccable harden.
5. **[P3] Live-region gaps.** Result-count changes not announced (no aria-live); unnamed hidden select shims ("installs", "any") pollute the SR tree. Suggested: $impeccable harden.

## Sort placement (owner's question)

Current placement is defensible but the control row under-earns its 46px, and sort is the tenant keeping alive a row that repo mode proves unnecessary. Sort is a result-view preference — semantically the chin's kin (Publisher/Audit also "parametrize the query", so the stated row/chin rationale doesn't actually distinguish them). Costs of the current spot: it floats alone and can read as a label; the auto-swap to Relevance happens outside the locus of attention; mobile already treats sort as a chin/sheet concern, so the breakpoints disagree about what sort is.

Recommendation: move sort to the chin and delete the control row by promoting the two icon toggles into the input row's trailing addon. The card becomes two layers in both modes; the mode morph simplifies to icon/placeholder/chin swaps; the sticky card loses ~46px of permanent height. Tradeoffs: chin left cluster grows to 4 (at the chunking limit), ghost sort slightly less discoverable, trailing addon busier during active queries. If the row must stay for future controls, give it a job that communicates (e.g. host the result count / relevance explanation).

## Persona Red Flags

**Alex (power user):** no keyboard path into repo mode; Enter in search is a no-op (no jump-to-first-result); cannot narrow 60 repo matches; the owner/repo carry-over is undiscoverable.
**Sam (accessibility):** Official pressed state is icon-tint only; result counts not in a live region; "Invalid GitHub URL" likely unannounced; unnamed hidden textboxes in reading order. Positives: aria-busy/role=status on the skeleton, real aria-labels, correct inert.
**Casey (mobile):** unlabeled GitHub square reads as "view source", not "match repo"; stack chips push results below the fold at 390px; bundle bar overlaps the last list row.

## Minor Observations

- Stale search params ride along in repo-mode URLs (?q=react&official=true&mode=repo).
- "javascript" lowercase in "Detected in shadcn-ui/ui · javascript".
- Group rows (5 versions) lack checkbox + install count — anatomy breaks scanning rhythm vs singleton rows.
- Disabled Analyze for free users has no inline reason at the button.
- Three names for one surface: "Hot/Trending" label, "Hot + Trending leaderboards" aria, sheet content.
- Contrast spot-checks pass (helper text ≈6:1 at 12px; Analyze white-on-blue fine).

## Questions to Consider

1. Repo mode proves the card works as two layers — what would have to be true for search mode to deserve a third?
2. Official appears as nav item, toggle, and row badge — is it a filter, or the default view users are made to opt into?
3. Analyze ends at a list of 60; the hero promises "one install command." Why doesn't repo matching preselect its top matches into the bundle bar and close its own loop?
