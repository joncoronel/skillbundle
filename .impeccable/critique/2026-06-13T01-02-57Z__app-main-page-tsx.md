---
target: home page (app/(main)/page.tsx)
total_score: 27
p0_count: 0
p1_count: 3
timestamp: 2026-06-13T01-02-57Z
slug: app-main-page-tsx
---
# Design Critique — SkillBundle Home Page

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Strong (spinner, "Copied!", live count); Compare vanishes silently at 4+ skills; "100 results" is a cap shown as an exact count |
| 2 | Match System / Real World | 3 | owner/repo + install counts are dev-native; "skill" and "bundle" never defined anywhere on the page |
| 3 | User Control and Freedom | 2 | Escape doesn't close the expanded bundle tray; "Clear all" is instant with no undo and hidden on mobile |
| 4 | Consistency and Standards | 3 | Two stacked tablists (Search/Repo + Popular/Trending/Hot); differentiated enough to work |
| 5 | Error Prevention | 3 | Cap disables checkboxes, "install may fail" badges; Clear all unguarded |
| 6 | Recognition Rather Than Recall | 3 | Selections visible in-list and in tray; Compare's 2–3 rule lives only in the user's head |
| 7 | Flexibility and Efficiency | 3 | `/` shortcut, URL-backed state, persisted selection; keyboard bulk-select broken by focus steal |
| 8 | Aesthetic and Minimalist Design | 4 | The strongest dimension: dense, sharp, one accent, zero decoration |
| 9 | Error Recovery | 2 | "No skills found for X" is good; no retry/error affordance for failed search or repo analysis |
| 10 | Help and Documentation | 1 | Zero explanatory affordances: no Official-badge tooltip, no Repo-tab hint, no "what's a skill?" |
| **Total** | | **27/40** | **Acceptable (top of band)** |

## Anti-Patterns Verdict

Does this look AI-generated? **No** — both assessments independently agree.

- LLM assessment: real point of view (pixel display font, ranked install-count table as working surface, momentum chips, custom dot-matrix spinner, one reserved accent). Not the centered-hero-plus-cards template. Weakest moment: the empty Repo tab.
- Deterministic CLI scan: clean — 0 findings across all 9 home-page source files.
- Browser-injected detector: 2 findings, both library-level: `layout-transition` (cubby-ui Crossfade/Collapsible `transition: height` — intentional primitive, but per-frame layout work; corroborates the dev-overlay jank note) and `clipped-overflow-container` (Sheet slide-animation viewport — false positive).

## Priority Issues

1. **[P1] Selecting a skill steals keyboard focus.** Space on a row checkbox mounts the bundle Sheet and focus jumps to the tray toggle (confirmed via document.activeElement); on reload with a stored selection, initial focus lands in the bar. Breaks bulk keyboard selection on the core action. Fix: suppress Base UI Sheet initial-focus in components/bundle-bar.tsx (non-modal status surface should never take focus). → /impeccable harden
2. **[P1] Escape doesn't close the expanded tray.** aria-expanded stays true; window keydown listener (bundle-bar.tsx:67) preempted, likely by Sheet keyboard capture. Tray covers 6+ rows with no keyboard exit. Fix: route Escape through the Sheet's keyboard handling or a capture-phase listener. → /impeccable harden
3. **[P1] Repo tab is an unexplained void.** Blank content area, no copy/example/output hint. Dead end for first-timers; hides the strongest task-mode feature. Fix: empty state in RepoAnalysisResults with one-sentence explanation + one-click example repo. → /impeccable onboard
4. **[P2] Compare silently disappears at 4+ selections.** Constraint (2–3) exists only in user memory. Fix: keep rendered but disabled with "Compare works with 2–3 skills." → /impeccable clarify
5. **[P2] Clear all is instant, irreversible, desktop-only.** No undo; max-sm:hidden removes the affordance on mobile. Fix: undo toast + mobile-reachable equivalent in the tray. → /impeccable harden

## Persona Red Flags

- **Alex (power user):** focus steal kills Space-Space-Space selection; no install-count sort on search results (live: 269-install exact match ranked above 2.4k row); no select-all/range select; tray lacks reorder so install-command order is uncontrollable pre-save.
- **Jordan (first-timer):** "skill" never defined; Official badge unexplained; Repo tab dead end; "Copy install" gives no hint output is a terminal command.
- **Sam (a11y):** focus steal + Escape failure most painful here; 2 tab stops × infinite rows makes the end-of-DOM bundle bar unreachable by Tab with no skip link; skill-name trigger has faint 50%-alpha focus outline on dark rows.

## Cognitive Load

7/8 pass. Fails: working-memory bridges (Compare 2–3 rule, Repo mode purpose live only in user's head); borderline: expanded tray with 3 skills = 8 interactive targets in one floating surface.

## Emotional Journey

Peak: first tick → bar slides up → Copy install → "Copied!" — tight loop. Valleys: Repo tab blank (curiosity punished); "Sign in to save" gives no reassurance the selection survives the redirect (it does, via localStorage, but users can't know); Clear all instant with no undo. Peak-end fine; valleys mid-journey.

## Minor Observations

- Crossfade/Collapsible height transition: per-frame layout over 30-row pane (dev overlay + detector agree); consider transform/clip if low-end jank surfaces.
- "100 results" → "100+ results" (cap, not count).
- 375px: long names wrap, Official badge separates from name.
- Floating bar covers bottom rows mid-scroll; pb-20 only protects list end.
- URL-backed ?q/?tab state is quietly excellent — undersold.

## Questions to Consider

1. What would "add to bundle" look like as a native table idiom (rank number → + on hover) instead of a checkbox column?
2. At what selection count should the floating pill hand off to a real workspace?
3. Why is Repo mode a second tab with zero explanation rather than the hero's second sentence?
