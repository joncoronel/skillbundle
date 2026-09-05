---
version: 1
slug: "app-main-add-page-tsx"
primary_target: "app/(main)/add/page.tsx"
related_targets: ["components/add-skill/add-skill-flow.tsx","components/add-skill/entry-preview.tsx","components/add-skill/add-outcomes.tsx"]
---

# Add page

**Scope:** `/add`, the public intake for a skill the catalog is missing, plus
the same flow mounted in the search empty-state dialog. **Mode: Operate.**

**Audience and job.** Someone who looked for a skill, did not find it, and has a
link in hand. Most arrive signed out, which is the default view the page has to
be good in. The job is one paste and one submit.

**Task.** Read what was pasted, show the entry it would create, and get out of
the way.

**Content.** One field and its action; the entry preview (name, mono source and
file); the three accepted forms as one-click samples; the
three outcomes of a submit in one line each; the free plan's GitHub-only
allowance for a signed-in free user, inside the outcome it meters.

**Constraints.**
- `AddSkillFlow` is shared with `AddSkillDialog`. `variant` names the substrate
  for the field AND decides whether the inset frame renders: `default` frames
  (the page), `elevated` mounts bare on the dialog's muted body, where a second
  muted frame would be a card in a card.
- The route is fully static and `e2e/instant-navigation.spec.ts` guards that by
  asserting the h1, the subhead, the preview's empty sentence and the first
  outcome term render in the shell. Their wording is load-bearing for that test.
  The only Convex read on the page is the quota, client-side by design.
- Every focus move in the flow is deliberate; controls unmount under the user on
  most exits (candidate card, quota wall, the sample chips). Read the module
  header in `hooks/use-add-skill-field-a11y.ts` before touching `disabled` /
  `readOnly` anywhere here.
- Sample inputs must be real catalog entries and must carry their URL scheme;
  `tests/add-skill-reading.test.ts` guards the form.

**Direction (September 2026): the entry preview.** The field writes the catalog
entry it would create, live. One inset frame (the home composer's object) holds
the field, its neutral (near-black) action and the preview panel, all lifted on the frame's muted
gutter with no hairlines of their own; the panel is drawn in the catalog row's
own vocabulary so what you preview is recognisably what you land on. This
replaced a gray recessed readout that listed the accepted forms as URL rows and
a three-paragraph outcomes register, both of which read as help prose around a
form. The preview's floor is measured per breakpoint against its tallest frame
(the reference frame at both widths) and the parsed row is always two lines
because the file path shares the source line.

**Do not.**
- Do not turn the preview red while someone is typing. It guides; the submit
  notice judges. `text-foreground` is the strongest it goes.
- Do not let the preview announce. The flow's `#add-skill-notice` owns
  announcements; a per-keystroke live region would make the field unusable with
  a screen reader.
- Do not put a state light on the preview row. It was tried: before a submit
  it can only say "not checked", and during one it duplicates the button's own
  progress label, so it read as a control that did nothing.
- Do not restore the sidebar or the outcomes register. The quota belongs inside
  the outcome it meters, and the outcomes are one line each because the preview
  already says which path an input is on.
