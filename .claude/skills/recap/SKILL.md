---
name: recap
description: Plain-language summary of what changed and why — for a branch, PR, uncommitted work, or a commit range. Explains the causal chain from the original goal to where things stand now, grouped by intent rather than by file, plus status and next steps. Use for "recap", "what have we changed so far", "summarize this PR vs main", "catch me up on this branch", or a wrap-up at the end of a feature.
---

# Recap

Explain a body of work to the person who owns it, in the terms they'd use.
Two moments this is for: **mid-development**, when the thread of what's been
done and why has gotten long, and **end of feature**, when reviewing the
whole change before merging.

This is not a changelog. `git log` already exists and is useless for this
purpose. The job is to reconstruct *intent* — what was wanted, what that
turned up, what it turned into — and state where things stand.

Run this **inline** in the current session. No subagents: there's no
judgment to keep independent here, and if this session did the work, its
memory of the reasoning is the single best source for the "why".

## Scope

- *(bare)* — current branch vs its merge-base with the default branch.
- `<PR#>` — that PR vs its base (`gh pr view <n>`, `gh pr diff <n>`).
- `staged` / `working` — uncommitted changes only.
- `<ref>..<ref>` — an explicit commit range.
- `since <date/ref>` — work since a point in time.

Quote paths in shell commands — parens and spaces (e.g. route groups like
`app/(main)/...`) break unquoted.

## Gather before writing

Cheap, in rough priority order. Stop when you can explain the *why*, not
just the *what*:

1. **This conversation**, if the work happened here — the strongest source
   for intent and for the causal chain between changes.
2. **Commits**: messages and order tell the story of how the work evolved
   (`git log --oneline`, `git diff --stat`).
3. **The PR description**, if one exists.
4. **Artifacts that record intent**: `reviews/*-review.md` (a panel review's
   finding counts, dispositions and final verdict), `plans/`, `TODO.md`
   entries, and any `docs/` file the diff itself modified — docs changed
   inside a diff usually state the design intent outright.
5. **The code**, last — to confirm what the above claims, and to catch
   anything undocumented.

**If the "why" genuinely can't be reconstructed, say so** ("the commits
don't record why X was changed") rather than inventing a plausible
rationale. A recap that quietly guesses at intent is worse than one that
admits a gap.

## Output shape

Print it in chat. Don't write a file unless asked.

```markdown
<One line: scope vs base, and the scale — "Five commits, ~8 files.">

## What it does

1. **<Headline: the effect, in plain words>**
   <2–4 sentences. Lead with the symptom or capability a person would
   notice. Then just enough mechanism to make it make sense. Anchor to a
   concrete event where one exists.>

2. **<Next one>**
   <...>

## Why

<The causal chain in 2–4 sentences: what was originally wanted → what that
surfaced → what it became. This is the section people actually re-read.>

## Status

<Where it stands, what's left, and what to do next — in order, including
any deploy/migration sequencing the changes imply.>
```

Group items by **intent** — a bug fix, a new capability, fixes from review —
not by file or by commit. Three to five items is usually right; if you have
ten, you're listing changes instead of explaining work.

## Writing rules

These are what separate a good recap from a diff summary:

- **Effect first, mechanism second.** "New skill content showed up blank"
  before "the cache tag was pinged before content landed". Someone should
  understand the problem before they meet the machinery.
- **Anchor to real events.** "This is exactly what happened with
  improve-ui" turns an abstract bug into one the reader remembers. Use
  these whenever the history supplies one.
- **Plain words.** Avoid function, table, and API names unless the name
  *is* the point; if a term is unavoidable, gloss it in the same sentence.
  A reader who's been away for a week should follow it without opening the
  code.
- **Numbers beat adjectives.** "2 rounds, 14 findings, all resolved" says
  more than "extensive review".
- **Under a minute to read.** Roughly 400 words. Cut ruthlessly — length
  is the most common way this goes wrong.
- **Report, don't sell.** No "great work", no "robust solution". State what
  is.
- **Flag the unverified.** If something is untested, assumed, or known-
  incomplete, say so in Status. This is often the most valuable line.

## Anti-patterns

- A file-by-file walkthrough (that's `git diff --stat`).
- Restating commit messages in order.
- Code blocks or line numbers — this is prose; cite a path only when the
  reader would need to go there.
- Explaining *what the code does* while never saying *why it exists*.
- Padding a small change into a long summary to look thorough.
