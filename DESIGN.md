---
name: SkillBundle
description: Discover, compare, and bundle AI coding assistant skills for your tech stack
colors:
  signal-blue: "oklch(0.6 0.2 250)"
  signal-blue-ring: "oklch(0.55 0.2 250)"
  on-signal: "oklch(1 0 0)"
  ink: "oklch(0.18 0.004 270)"
  ink-muted: "oklch(0.5 0.004 270)"
  field: "oklch(0.97 0 0)"
  surface-raised: "oklch(1 0 0)"
  secondary: "oklch(0.92 0 0)"
  border-hairline: "oklch(0 0 0 / 0.1)"
  destructive: "oklch(0.53 0.19 25)"
  success: "oklch(0.48 0.18 145)"
  warning: "oklch(0.58 0.14 85)"
  info: "oklch(0.45 0.2 250)"
typography:
  display:
    fontFamily: "var(--font-geist-pixel-circle), ui-monospace, monospace"
    fontSize: "clamp(3.5rem, 6vw, 5rem)"
    fontWeight: 400
    lineHeight: 0.95
    letterSpacing: "normal"
  headline:
    fontFamily: "var(--font-geist-sans), system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "var(--font-geist-sans), system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "var(--font-geist-sans), system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
  section:
    fontFamily: "var(--font-geist-sans), system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    letterSpacing: "normal"
  label:
    fontFamily: "var(--font-geist-sans), system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "normal"
  micro:
    fontFamily: "var(--font-geist-sans), system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
    letterSpacing: "normal"
rounded:
  md: "10px"
  lg: "12px"
  xl: "14px"
  2xl: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.signal-blue}"
    textColor: "{colors.on-signal}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
    height: "36px"
  button-outline:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
    height: "36px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
    height: "36px"
  badge-default:
    backgroundColor: "{colors.signal-blue}"
    textColor: "{colors.on-signal}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
  input-default:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
    height: "36px"
  card-default:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.2xl}"
    padding: "24px"
---

# Design System: SkillBundle

## 1. Overview

**Creative North Star: "The Control Panel"**

SkillBundle looks like a precision instrument for builders. The base is an almost-monochrome neutral field carrying a single blue signal color that means one thing: this is the action. Identity comes from contrast, exact alignment, and a few deliberate motifs (the Geist Pixel display face, the dot-matrix loading ripple) rather than from decoration. It borrows Firecrawl's restraint (clean neutrals, generous gutters, one accent used sparingly) and Nothing OS's confidence (high contrast, bold typographic hierarchy, dot-matrix detailing on a monochrome base).

The neutral palette is hue-tinted, not flat gray: every neutral carries a trace of violet (`--neutral-hue: 270` at chroma `0.004`), which keeps large surfaces from reading as dead gray and gives dark mode a cool, considered cast. Depth is real but quiet, built from an eight-step surface elevation system (`surface-1` through `surface-8`) where each level pairs a tonal background, a layered shadow, and an inset rim highlight. Light and dark are equal first-class themes driven by the same token names.

This system explicitly rejects: generic SaaS landing pages with gradient hero blobs, glassmorphism-heavy dashboards, playful/cartoon dev-tool styling, and anything that reads as template-generated. The blue accent is a signal, never a gradient or a glow.

**Key Characteristics:**
- Near-monochrome neutral field, one blue accent used as a rare signal.
- Violet-tinted neutrals (`hue 270`, `chroma 0.004`), never pure gray.
- Eight-step tonal + shadow elevation system, equal light/dark themes.
- Geist Pixel display face and dot-matrix loader as deliberate identity marks.
- Fast, tactile interactions: 100ms transitions, a 0.98 active-press scale.

## 2. Colors

A near-monochrome neutral base, one saturated blue signal, and a full semantic state vocabulary held in reserve.

### Primary
- **Signal Blue** (`oklch(0.6 0.2 250)`): The single accent. Primary buttons, active/selected states, focus rings (`oklch(0.55 0.2 250)`), links, and key highlights. Nothing else competes with it, which is why it reads as "the action."

### Neutral
- **Ink** (`oklch(0.18 0.004 270)`): Primary text on light surfaces; near-black with a trace of violet.
- **Ink Muted** (`oklch(0.5 0.004 270)`): Secondary text, captions, placeholder text, ghost-button labels. Tuned to stay above 4.5:1 on the field; do not lighten it for "elegance."
- **Field** (`oklch(0.97 0 0)`, `surface-1`): The page background. The lowest elevation level.
- **Surface Raised** (`oklch(1 0 0)`, `surface-3`): Cards, inputs, popovers; pure white in light mode, lifted off the field by shadow and rim.
- **Secondary** (`oklch(0.92 0 0)`): Secondary/soft button fills, quiet chips.
- **Hairline Border** (`oklch(0 0 0 / 0.1)`): All borders and dividers; a 10% black (10% white in dark mode) so it reads as a hairline, never a stripe.

### Tertiary (semantic states)
- **Destructive** (`oklch(0.53 0.19 25)`): Delete/danger actions and validation errors.
- **Success** (`oklch(0.48 0.18 145)`), **Warning** (`oklch(0.58 0.14 85)`), **Info** (`oklch(0.45 0.2 250)`): Status badges and alerts only. Each ships a paired `-foreground`, `-border`, and tinted background token for light and dark.

### Named Rules
**The One Signal Rule.** Signal Blue appears on a small fraction of any screen: primary action, current selection, focus. Its rarity is the entire point. If two blue things compete on a screen, one of them is wrong.

**The No-Gray-Gray Rule.** Neutrals are never `chroma 0`. Every neutral inherits `--neutral-hue: 270` at `--neutral-chroma: 0.004`. Pure gray is forbidden; the violet trace is what keeps the interface from feeling dead.

## 3. Typography

**Display Font:** Geist Pixel Circle (with `ui-monospace` fallback)
**Body Font:** Geist Sans (with `system-ui, sans-serif` fallback)
**Code Font:** Geist Mono (with `ui-monospace, monospace` fallback)

**Character:** A geometric, technical sans carries the entire interface. The pixel-grid display face marks hero moments, and the monospace is reserved for machine strings. The contrast is structural (sans vs. pixel vs. mono), not three competing sans-serifs.

### Hierarchy
- **Display** (Geist Pixel Circle, `clamp(3.5rem, 6vw, 5rem)`, line-height 0.95): Hero headlines and large brand moments only.
- **Headline** (Geist Sans 600, 1.875rem, -0.02em): Page and section headings.
- **Title** (Geist Sans 600, 1.125rem): Card titles, panel headers.
- **Section** (Geist Sans 600, 0.875rem, `text-foreground`): Named blocks inside a page — the `LabeledSection` heading, sidebar sections, comparison groups. A real heading element, sentence case.
- **Body** (Geist Sans 400, 0.875rem, line-height 1.6): Default UI and prose; cap prose at 65–75ch.
- **Field label** (Geist Sans 500, 0.75rem, `text-muted-foreground`): What names a column, a `dt`, or a value — table headers, stat cells, metadata. Sentence case, normal tracking.
- **Micro** (Geist Sans 500, `text-micro` / 0.6875rem): Pills and dense chips only. The floor; nothing smaller.

### Named Rules
**The Pixel Floor Rule.** Geist Pixel Circle collapses to ordinary mono below ~40px. Never set the display face below 60px; at small sizes it stops reading as pixel-grid and just looks like a broken mono. Display is for hero scale only.

**The Sentence Case Rule.** Nothing in this interface is set in `text-transform: uppercase`. Not eyebrows, not table headers, not status pills, not section labels. Wide-tracked capitals are the default costume of a generated dev-tool UI, and a small caps label is also the least legible way to set the smallest type on the screen. A word that arrives from an API as a raw enum (`warn`, `HIGH`) is normalised to sentence case before it is rendered — see `formatVerdict` in `components/monitoring/condition-meta.ts`. Literal machine constants that are genuinely written in caps (`500 INTERNAL_ERROR`, `SKILL.md`) are quoted as-is, in mono; that is content, not a type treatment.

**The Mono-Is-Data Rule.** Geist Mono means "this is a machine string you could copy": install commands, code and `<pre>`, file paths, `owner/repo` identifiers, version strings, diff `−`/`+` markers, error digests. It is not a way to make a label look technical. Two consequences worth stating, because both were violated across the app: a label never gets mono just because it sits near data, and a metadata line like "42 skills · 1.2k installs" gets `tabular-nums` — which is the actual requirement, stable digit widths — not `font-mono`, because it is a sentence with numbers in it.

## 4. Layout

There is no container in the route shell. `app/(main)/layout.tsx` holds the
sticky header, the children, and the global bundle bar; **every page owns its
own width.** That is deliberate, because a catalog table and a sign-in form want
different measures, but it means a new page inherits nothing and must state one.

### Containers

- **`max-w-6xl` (72rem) with `mx-auto px-4`** is the default page width, and the
  one to reach for unless there is a reason not to. Catalog pages, leaderboards,
  the dashboard, and the bundle page all use it.
- **`max-w-4xl` / `max-w-2xl`** for reading surfaces, where measure beats
  density. Prose inside them still caps at 65–75ch (§3).
- **`max-w-md` / `max-w-sm`** for the auth column and other single-task forms.
- Horizontal padding steps with the viewport on the header (`px-4 sm:px-6
  lg:px-8`) but stays flat at `px-4` on page bodies. Match the page bodies.

### Vertical rhythm

`pt-12` above the first element and `pb-20`/`pb-24` below the last. The generous
tail is intentional: the global bundle bar floats over the bottom of the
viewport, and a short page with a tight `pb` puts its last row under the bar.

Between sections, `mt-10` is the standard gap and `mt-12 lg:mt-14` marks a
harder break (the skill page uses the larger step before Documentation). Inside
a section, more space above a heading than below it.

### Breakpoints

Tailwind's defaults, unmodified: `sm` 640px, `md` 768px, `lg` 1024px, `xl`
1280px. Two habits matter more than the values:

- **Collapse, do not reflow type.** At small widths the sidebar collapses and
  trailing table columns fold into the primary cell. Type size holds.
- **`sm:sr-only`, never `sm:hidden`,** for anything that is the only thing
  naming a column, a plan, or an owner (§8 Don'ts).

### Anchors

A section that is a link target takes `scroll-mt-20` so the sticky `h-14` header
does not cover the heading the link just jumped to, plus `tabIndex={-1}` so
focus moves with the jump. `LabeledSection` does both when given an `id`.

## 5. Elevation

Depth is a first-class system, not an afterthought. Eight surface levels (`surface-1`–`surface-8`) each combine three things: a tonal background that lightens as it rises (in dark mode) or stays near-white (in light mode), a layered drop shadow (`--surface-shadow-N`), and an inset rim highlight (`--surface-rim-N`) that simulates a lit top edge. The result is tactile but quiet; elevation reads as material, not as a glow.

In light mode, lift comes mostly from shadow over a near-white surface. In dark mode, lift comes mostly from the tonal step plus a subtle top-edge rim, with shadows kept soft. Components opt into a `level` (background tier) and `shadowLevel` (shadow tier) independently.

### Shadow Vocabulary
- **`--surface-shadow-1`** (`0 0 0 1px ring`): Flush elements; a hairline ring with no drop. Default card shadow level.
- **`--surface-shadow-3`** (ring + near + mid layers): Resting cards and popovers.
- **`--surface-shadow-5`–`8`** (progressively deeper, longer-throw layers): Dialogs, menus, and overlays. The higher the level, the more ambient the far shadow.

### Named Rules
**The Material Depth Rule.** Shadow level and surface level are tuned together so a raised element looks lit, not pasted. Never hand-roll a `box-shadow`; use a `surface-N` level so light and dark stay coherent.

## 6. Shapes

One radius variable drives everything. `--radius: 0.75rem` (12px) is the root,
and every step is computed from it (`--radius-xs` = root − 6px through
`--radius-4xl` = root + 8px), so retuning the whole form language is a one-line
change and no component carries a hardcoded corner.

### The radius scale

| Token | Value | Where |
| --- | --- | --- |
| `rounded-sm` | 8px | Nested chips, inline code |
| `rounded-md` | 10px | Badges, `xs` buttons |
| `rounded-lg` | 12px | Buttons, inputs, list rows. The default. |
| `rounded-2xl` | 16px | Cards and panels |
| `rounded-full` | circle | Avatars, dots, the status light ring, icon-only controls |

### Borders

The hairline (§2) at 1px is the only border on surfaces: cards, inputs, list
rows, dividers, table cells. Two exceptions exist and both are deliberate, so do
not "correct" them:

- **`border-2` on a control whose stroke is the affordance,** not a container
  edge. The slider thumb and the timeline node are the whole list.
- **A coloured `border-l-2` as a gutter marker inside the code block,** where it
  marks a line as added, removed, modified, or highlighted. This is the one
  place a coloured left edge carries information. It stays banned on cards, list
  rows, callouts, and alerts (§8 Don'ts), where it is decoration.

### Named Rules

**The One Elevation Signal Rule.** An element declares depth once, with a border
or with a shadow, never both. A 1px border under a wide soft shadow is the ghost
card: it reads as a mistake rather than as material. Cards use `surface-N`;
flush elements use the hairline.

**The Pill Floor Rule.** `rounded-full` is for things that are actually round:
an avatar, a dot, a status ring, a square icon-only control. A text button, a
card, or an input never goes to a pill, because the rectilinear grid is what the
rest of the system is built on and one pill in a row of 12px corners reads as a
different component.

## 7. Components

Built on the cubby-ui library (Base UI primitives + CVA variants). Components are crisp and tactile: subtle real depth, fast feedback, a physical press.

### Buttons
- **Shape:** Gently rounded (`rounded-lg`, 12px; `rounded-md`, 10px on the `xs` size).
- **Primary:** Signal Blue fill, white text, `hover:` darkens 5% (`--primary-hover`). Default height 36px (40px on touch), `px-3 py-2`.
- **Variants:** `primary-soft` (secondary fill, blue text), `neutral`, `outline` (raised surface + hairline border), `secondary`, `ghost` (muted text, fills with `surface-hover` on hover), `destructive` / `destructive-soft`, `link`.
- **States:** `focus-visible` draws a 2px offset ring at `ring/50`; `active` removes shadow and scales to `0.98` (the press). All transitions 100ms `ease-out`.
- **Loading:** swaps a section for the `DotMatrixRipple` spinner (the dot-matrix identity mark), never a generic spinner.

### Badges / Chips
- **Style:** `rounded-md` (10px), `px-2.5 py-1`, `text-xs` 500. Default is a Signal Blue chip with a faint drop shadow.
- **State variants:** `neutral`, `outline`, `secondary`, plus semantic `success` / `warning` / `info` / `danger`, each with matched tinted bg, foreground, and border.

### Cards / Containers
- **Corner Style:** `rounded-2xl` (16px).
- **Background:** Surface Raised (`surface-3`); `inset` variant uses a `muted` gray frame around a raised inner panel.
- **Shadow Strategy:** `level={3}` background with `shadowLevel={1}` by default; see Elevation. Never a hand-rolled shadow.
- **Internal Padding:** 24px default (`py-6`, `px-6` on header/content); `gap-6` between sections.

### Inputs / Fields
- **Style:** Hairline border, `rounded-lg` (12px), 36px height. `default` variant on opaque `bg-input`; `elevated` variant (`bg-input-elevated`, translucent) for use inside cards and dialogs.
- **Focus:** 2px offset ring at `ring/50`, 100ms; border-color transition 200ms.
- **Invalid:** 2px offset `destructive` ring via `aria-invalid`.

### Navigation
- Neutral by default, Signal Blue marks the active item. Section headers take the Section role (§3) at `text-xs` in the narrow sidebar column; sidebar uses `surface-1` with a hairline border. Collapse the sidebar at small breakpoints rather than reflowing type.

### Status light and condition vocabulary

The monitoring surfaces (the dashboard change panel, the bundle register) share
one state readout, and it is system rather than local — a third surface must
reuse it, not reinvent it.

**This now has one implementation, and it is not optional.** `Condition`,
`CONDITION_RANK`, `GROUP_OF` and `resolveCondition` live in
`lib/monitoring/conditions.ts`, which is dependency-free so `convex/` imports it
too; `StatusLight`, `DescriptionDelta` and `CONDITION_META` live in
`components/monitoring/`. Stating the vocabulary here and letting each surface
build its own was not enough: a panel review found three status lights across
five tone vocabularies for three colours, two `DescriptionDelta` copies that had
already drifted on measure and on their empty-input guard, and — because the
server owned a SHORTER ranking than the client — a dashboard that rendered a
green all-clear over a delisted dependency the bundle page was calling "Needs
attention". Add a condition in the shared module or not at all.

**Faults are states, not events.** `delisted` and `fetch-error` have no
timestamp and no read-state: nothing records when a skill was delisted, so
render no relative time for one, and never let "mark all read" clear it —
reading that a dependency is gone does not bring it back.

- **The light.** A `size-1.5` dot centred in a `size-5` ring of its own hue at
  20% (15% for the neutral tones). Small on purpose: the healthy state is the
  common one, so a large green mark would be seen every visit and learned as
  noise. Five tones, in this order of precedence:
  `pending` (`muted-foreground`, pulsing, `motion-reduce:animate-none`) →
  `empty` (`muted-foreground`) → `fault` (`danger-foreground`) →
  `changed` (`warning-foreground`) → `clear` (`success-foreground`).
- **Pending and empty are never green.** They resolve ahead of `clear` in the
  precedence chain because both used to fall through to it, which made a surface
  claim "nothing has changed" before it had checked. In a monitoring product an
  unverified all-clear is the one state that costs trust.
- **Condition ranking.** One ordering carries triage everywhere:
  security regression → delisted → install-may-fail → description changed →
  content edited → steady. Sort by it and the worst item is the first row; no
  surface needs a separate "needs attention" section.
- **Consequence outranks recency.** A verdict that went `pass → fail` three
  weeks ago sits above a typo fix from an hour ago.
- **The state is never colour alone.** Every condition pairs its tone with a
  distinct HugeIcons glyph and a text label, `sr-only` where the visible row
  stays quiet. Diffs use `−`/`+` notation in mono so additions and removals
  survive without hue.

### Register table

A dense `<table>` is the right form for an inventory whose rows carry state —
the reader scans a column, which is a relationship a screen reader should get
for free. Notes that are easy to lose:

- `Table` ships `md:max-w-2xl` and `TableCell` ships `whitespace-nowrap`, both
  correct for a table beside other content and both wrong for a table that IS
  the content. Override with `md:max-w-none` and `whitespace-normal` on the
  prose cells.
- `table-fixed` with explicit column widths, and `w-auto` rather than a
  percentage on the primary column at the narrowest breakpoint — under fixed
  layout the browser distributes leftover width across declared columns, which
  inflates a narrow marker column and squeezes the content beside it.
- Header cells take the Field label role (§3), not the component default. Only
  the size is overridden (`text-xs`); `TableHead` already supplies the weight
  and the muted colour.
- At narrow widths drop trailing columns and fold their content into the primary
  cell. Never leave a column parked off-screen behind a horizontal scroll: the
  column the reader came for is the first one to disappear that way.
- **Section, do not just sort.** When rows carry a ranked condition, group them
  into labelled sections (a full-width `<tr>` header inside one table, so the
  columns stay aligned across sections) rather than relying on sort order alone.
  The ranking becomes structure the reader can see instead of a pattern they
  have to infer, each section carries its own count, and the quiet section can
  fold. Reuse the status-light dot on the section header — same vocabulary as
  the readout above it.
- **A summary above a sectioned table earns its place only by saying something
  the sections cannot.** Counts belong to the section headers; the summary keeps
  the verdict (checking, all clear) and goes silent otherwise rather than
  restating them.
- Hover state must be OPAQUE. `bg-surface-hover` is a translucent tint for
  layering, and Table applies it as the cell's `background-color`, which
  replaces the opaque fill so the tint composites over the container instead —
  darker than the header strip in light, lighter in dark. Use `surface-2`, which
  sits between cell and header strip in both themes.

### Signature: Dot-Matrix Ripple
The loading indicator (`DotMatrixRipple`) is a grid of dots that ripple in sequence, echoing the Nothing OS dot-matrix motif. It is the project's loading vocabulary everywhere a spinner would otherwise go.

## 8. Do's and Don'ts

### Do:
- **Do** keep Signal Blue (`oklch(0.6 0.2 250)`) rare: primary action, active state, focus, links. One signal per screen.
- **Do** tint every neutral toward `hue 270` at `chroma 0.004`; never use pure gray.
- **Do** use `surface-N` levels for any raised element so light and dark depth stay coherent.
- **Do** keep Ink Muted (`oklch(0.5 ...)`) for secondary text; verify ≥4.5:1 before lightening anything.
- **Do** reserve the Geist Pixel display face for ≥60px hero moments.
- **Do** use the `DotMatrixRipple` for loading states, not a generic spinner.
- **Do** give an unresolved state its own tone. Never let "not checked yet" or
  "nothing here" fall through to the success colour.
- **Do** hold layout height across a loading→resolved transition; a placeholder
  that occupies no space makes every row jump when data lands.
- **Do** keep transitions fast (100ms `ease-out`) and let the 0.98 active scale carry the press.

### Don't:
- **Don't** use gradient hero blobs or any `background-clip: text` gradient text. The accent is a single solid color.
- **Don't** use decorative glassmorphism; blur and glass are not the default surface.
- **Don't** set the Geist Pixel face below ~40px; it collapses into broken mono.
- **Don't** apply `uppercase` to anything, at any size, in any role. There is no
  label treatment that earns it back.
- **Don't** reach for `font-mono` on a label, a heading, a count, or a status
  word. Mono is for strings a machine produced and a user might copy.
- **Don't** hand-roll `box-shadow`; use the `surface-N` elevation system.
- **Don't** introduce a second accent hue or let two blue elements compete on one screen.
- **Don't** make it look template-generated, cartoonish, or like a generic SaaS landing page.
- **Don't** use a grid of same-size cards as the structure for a set whose items
  differ in state. Equal cards assert equal standing and bury the one that needs
  attention; that is what the register replaced on the bundle page.
- **Don't** fade `muted-foreground` below its own value (`/50`, `/60`) for
  elegance — it is tuned to land at 4.5:1 and anything under it fails the
  contrast floor.
- **Don't** strip `outline-none` from an interactive element without replacing
  the focus ring. A hover-identical underline is not a focus indicator.
- **Don't** unmount an `aria-live` region to hide it. A removed live region
  never announces, so a status readout that returns `null` on its interesting
  outcomes speaks only when the news is good. Keep the region mounted and vary
  its contents, `sr-only` if it should be visually silent.
- **Don't** apply an alpha step to `--danger` / `--success` / `--warning` and
  expect a visible tint. Those tokens are ALREADY the tinted background pair
  (near-white in light, near-black in dark); at 10% they composite to under
  1.01:1 against the cell. Use them at full strength and reserve the alpha for
  hover.
- **Don't** hide a label with `sm:hidden` when it is the only thing naming a
  column, a plan, or an owner. `display: none` removes it from the
  accessibility tree, so the layout gets wider and the reading gets worse; use
  `sm:sr-only`.
- **Don't** express a table's grouping with a `<td colSpan>` header row. A data
  cell has no relationship to the rows under it, so the grouping exists only
  visually. One `<tbody>` per group with `aria-labelledby` is the version a
  screen reader can navigate.
