---
version: 1
slug: "app-main-add-page-tsx"
primary_target: "app/(main)/add/page.tsx"
related_targets: ["components/add-skill/add-skill-flow.tsx","components/add-skill/input-readout.tsx"]
---

# Add page

**Scope:** `/add` — the public intake for a skill the catalog is missing, plus
the same flow mounted in the search empty-state dialog. **Mode: Operate.**

**Audience and job.** Someone who looked for a skill, did not find it, and has a
link in hand. Most arrive signed out, which is the default view the page has to
be good in. The job is one paste and one submit.

**Task.** Read what was pasted, resolve it, say which of the three outcomes it
is heading for, and get out of the way.

**Content.** One field and its action; a live readout of the parsed input
(source, slug, and the SKILL.md path a link already named); the three accepted
input forms as real, clickable catalog entries; the three outcomes of a submit;
the free plan's GitHub-only allowance for a signed-in free user.

**Constraints.**
- `AddSkillFlow` is shared with `AddSkillDialog`, so nothing in it may assume
  page substrate. That is what the `variant` prop is for: the dialog's own fill
  is `bg-input`, so the default opaque field vanishes into it.
- The route is fully static and `e2e/instant-navigation.spec.ts` guards that by
  asserting the h1 and the subhead render in the shell. The subhead's wording is
  load-bearing for that test. The only Convex read on the page is the quota,
  which is client-side by design.
- Every focus move in the flow is deliberate; controls unmount under the user on
  most exits (candidate card, quota wall, and now the example rows). Read the
  module header in `hooks/use-add-skill-field-a11y.ts` before touching
  `disabled` / `readOnly` anywhere here.
- Input examples must be real catalog entries and must carry their URL scheme.
  Without it the leading `github.com` is a dot-bearing first segment, which is
  the parser's signal for a well-known source, so the whole remainder becomes
  the slug. The pre-redesign placeholder advertised exactly that broken form.

**Direction.** Intake instrument. The page had one 36px field in the left column
of a two-column grid whose right column was help prose, and roughly half a
viewport of nothing under both — a rough draft in the literal sense. The fix was
not more content but a responsive object: `parseSkillInput` already ran here on
submit as a reject-and-explain gate, and running it per keystroke turns the field
into a readout that resolves as you paste. The panel under the field is one
window with two frames — the reference forms when there is nothing to read, the
resolved identifiers when there is — so it is never empty. Its height is a
`min-h` floor measured per breakpoint against the tallest frame, not a fixed
height: the floor is only as good as the copy inside it stays short, which is
why the message wraps with `break-words` and the parser caps the input it echoes
at 60 characters. Below it, the outcomes are a condition/result register rather than cards,
because two of the three add something and one does not, and equal cards would
assert they are peers.

**Do not.**
- Do not turn the readout red while someone is typing. It guides; the submit
  notice judges. `text-foreground` is the strongest it goes.
- Do not let the readout announce. It is ordinary content, not a live region;
  the flow's `#add-skill-notice` owns announcements and a per-keystroke live
  region would make the field unusable with a screen reader.
- Do not restore the sidebar. The quota belongs inside the outcome it meters.
