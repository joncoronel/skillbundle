---
version: 1
slug: "app-main-bundle-id-bundle-view-tsx"
primary_target: "app/(main)/bundle/[id]/bundle-view.tsx"
related_targets: ["components/bundle/bundle-register.tsx"]
---

# Bundle page

**Scope:** `/bundle/[id]` — one bundle, read by its owner or by anyone holding
its link. **Mode: Operate.**

**Audience and job.** The owner, returning to ask "is my setup still OK?" A link
visitor is reading someone else's answer to that question, which is the more
useful thing to share than a manifest. Both get the same surface; the visitor
loses only the owner controls and the read-state stamp.

**Task.** Answer the health question, then show what needs attention, then the
full holding, then how to reproduce it. In that order — inventory last of the
three, install last of all.

**Content.** Bundle identity; a tally (faults / changed / steady); one row per
skill carrying its condition, its change payload, its audit verdict and when it
joined; install commands grouped per source repo.

**Constraints.**
- Edit mode is the pre-existing `EditableSkillSection` staging grid. It carries
  no condition state, so the tally and register step aside while it is open
  rather than posing a question it cannot answer. Rebuilding it around register
  rows is open work, not settled.
- The change payload arrives over the client websocket after the bundle itself
  preloads. That gap must read as unresolved, never as healthy.
- The register baselines on `addedAt`, not on the last visit — this page answers
  "what changed since I added this", which must not clear when you look at it.
  The dashboard panel owns read-state; this page only stamps it.

**Direction.** Audit register. A bundle is a register of what you depend on, not
a gallery of what you collected; a grid of same-size cards asserts that twelve
dependencies are twelve equally-fine choices and hides the one that regressed.
Rows sort by consequence, so triage falls out of the ordering and no separate
"needs attention" block is needed. Full contract at the top of
`components/bundle/bundle-register.tsx`.

**Memorable moment.** A description change shows its before/after inline, in the
row. The description is what decides when an agent invokes a skill, so a stranger
editing it changes your agent's behaviour without touching your code — seeing the
two lines side by side is the product's whole argument, made without a sentence
of explanation.

**Sharing.** One link (`urlId`), one switch. Closed by default. The URL shows
greyed while closed, so what you are enabling is legible before you enable it.

**Unresolved.**
- No remedy on a fault row — a delisted or failing skill offers a link to its
  detail page but no "remove from bundle", which is the action you actually want.
- Past ~30 rows the register needs virtualisation, a collapsible steady tail, and
  a height cap so its sticky column strip stays put. A healthy 40-skill bundle is
  currently 40 rows of em-dashes, which is the version of "calm" that reads as
  "empty".
- Whether "bundle" survives as the noun. PRODUCT.md says watchlist.
