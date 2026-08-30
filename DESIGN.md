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
  chrome: "oklch(0.2 0.004 270)"
  chrome-foreground: "oklch(0.98 0.002 270)"
  destructive: "oklch(0.53 0.19 25)"
  success: "oklch(0.48 0.18 145)"
  warning: "oklch(0.58 0.14 85)"
  info: "oklch(0.45 0.2 250)"
typography:
  hero:
    fontFamily: "var(--font-sans), system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "clamp(2.5rem, 3.9vw, 3.5rem)"
    fontWeight: 640
    lineHeight: 0.95
    letterSpacing: "-0.03em"
  display:
    fontFamily: "var(--font-sans), system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "clamp(1.875rem, 2.8vw, 2.5rem)"
    fontWeight: 640
    lineHeight: 1
    letterSpacing: "-0.025em"
  display-sm:
    fontFamily: "var(--font-sans), system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "clamp(1.75rem, 2.4vw, 2.125rem)"
    fontWeight: 640
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "var(--font-sans), system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "var(--font-sans), system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "var(--font-sans), system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
  section:
    fontFamily: "var(--font-sans), system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    letterSpacing: "normal"
  label:
    fontFamily: "var(--font-sans), system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "normal"
  micro:
    fontFamily: "var(--font-sans), system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
    letterSpacing: "normal"
rounded:
  md: "10px"
  lg: "12px"
  xl: "14px"
  2xl: "16px"
  5xl: "24px"
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

SkillBundle looks like a precision instrument for builders. The base is an almost-monochrome neutral field carrying a single blue signal color that means one thing: this is the action. Identity comes from contrast, exact alignment, and typographic authority rather than from decoration or from a second face. It borrows Firecrawl's restraint (clean neutrals, generous gutters, one accent used sparingly) and Nothing OS's confidence (high contrast, bold typographic hierarchy) on a monochrome base.

**The dot-matrix world was retired in August 2026, deliberately and completely** — the Geist Pixel display face, the rippling dot loader, its comet and sweep siblings, and the static dot-grid backdrop behind empty states. It is recorded here because the reason generalises. The pixel face was specified for hero moments at 60px and up, and the app never had one: it rendered at 36px on the home page and 18px in the header wordmark, so on the two most-seen surfaces the identity mark was running below the size at which it stops being pixels at all. A motif that only works in a size band the product does not use is not an identity, and propping it up would have meant sizing headings to suit a font rather than the content. Do not reintroduce a second display family without first checking, in the browser, the sizes it would actually render at.

The neutral palette is hue-tinted, not flat gray: every neutral carries a trace of violet (`--neutral-hue: 270` at chroma `0.004`), which keeps large surfaces from reading as dead gray and gives dark mode a cool, considered cast. Depth is real but quiet, built from an eight-step surface elevation system (`surface-1` through `surface-8`) where each level pairs a tonal background, a layered shadow, and an inset rim highlight. Light and dark are equal first-class themes driven by the same token names.

This system explicitly rejects: generic SaaS landing pages with gradient hero blobs, glassmorphism-heavy dashboards, playful/cartoon dev-tool styling, and anything that reads as template-generated. The blue accent is a signal, never a gradient or a glow.

**Key Characteristics:**

- Near-monochrome neutral field, one blue accent used as a rare signal.
- Violet-tinted neutrals (`hue 270`, `chroma 0.004`), never pure gray.
- Eight-step tonal + shadow elevation system, equal light/dark themes.
- One family, SN Pro, across every text role — the display end is built from weight and tracking, not from a second face.
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

### Chrome (the off-ladder surface)

One container is deliberately **not** on the surface ladder: the header pill. Everything else is a step up from the field; this is the object the field flows past. It is near-black in **both** themes — light borrows `--neutral`, and dark goes a rung _below_ the page, since the dark page already sits at light's near-black.

Six tokens. Three are set per theme — `--chrome`, `--chrome-foreground`, and the edge token `--chrome-shadow` (§5). The other three derive from those roots, so retuning the surface moves the whole family.

**Do not paint on this surface by hand.** Put `data-surface="chrome"` on the container and use ordinary page classes inside — `text-muted-foreground`, `bg-accent`, `Button variant="ghost"`. A rule in `app/globals.css` re-points the page tokens for the whole subtree, so anything dropped in paints correctly with no per-control classes. `--primary` is left alone so a primary button keeps its brand fill anywhere, and portalled content (dropdowns, dialogs) renders at the body and correctly does not inherit. `bg-chrome` is the only chrome utility, for the fill itself; there is deliberately no `bg-chrome-hover`, because a second idiom for the same job is what the contract exists to remove. The one paint it cannot reach is `Skeleton`'s shimmer, whose colours are literals rather than tokens.

**The one case that pairs `bg-chrome` with NO `data-surface`: a `dark:`-only chrome fill.** The attribute earns its keep against a palette _inversion_ — in light, a near-black fill flips every foreground under it, so the subtree has to be handed the chrome tokens. Dark inverts nothing: `--chrome-foreground` is defined there as `var(--foreground)`, and `--chrome-muted-foreground` computes to 0.71 against the page's own 0.73. So a container that is `muted` in light and `chrome` in dark (the home page's search composer) takes `dark:bg-chrome` and `dark:[--popup-surface:var(--chrome)]` alone. Adding the attribute there would buy a rounding difference on the foregrounds and cost the one token that is not a near-match — `--input`, which it aims at `--chrome-hover`, dissolving any nested field from a raised `surface-3` panel into a 10% wash. Correct for a control on a nav pill; wrong when the field IS the instrument.

### Tertiary (semantic states)

- **Destructive** (`oklch(0.53 0.19 25)`): Delete/danger actions and validation errors.
- **Success** (`oklch(0.48 0.18 145)`), **Warning** (`oklch(0.58 0.14 85)`), **Info** (`oklch(0.45 0.2 250)`): Status badges and alerts only. Each ships a paired `-foreground`, `-border`, and tinted background token for light and dark.

### Named Rules

**The One Signal Rule.** Signal Blue appears on a small fraction of any screen: primary action, current selection, focus. Its rarity is the entire point. If two blue things compete on a screen, one of them is wrong.

**The No-Gray-Gray Rule.** Neutrals are never `chroma 0`. Every neutral inherits `--neutral-hue: 270` at `--neutral-chroma: 0.004`. Pure gray is forbidden; the violet trace is what keeps the interface from feeling dead.

## 3. Typography

**Text Font:** SN Pro, as `--font-sans`, carrying every text role from micro label to hero (fallback `system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif`). It has no entry in Next's font-metrics table, so `app/layout.tsx` loads it through `next/font/local`, which measures the file rather than looking it up, and vendors the subsetted variable woff2 to `app/fonts/`. Read the note in that file before moving it to `next/font/google`.
**Code Font:** Google Sans Code, as `--font-mono` (with `ui-monospace, monospace` fallback). Also has no metrics row, which is why it carries `adjustFontFallback: false` and an explicit stack — see `app/layout.tsx`.
**There is deliberately no display family.** `--font-display` was removed with the pixel face rather than repointed at SN Pro, because a family hook resolving to the body face is a no-op that reads as meaningful at every call site. The display ROLE lives in `--text-display` / `--text-display-sm`, which is a stronger marker: it carries the treatment, not just a name.

**Character:** One geometric, technical sans carries the entire interface, and the monospace is reserved for machine strings. The contrast is structural (sans vs. mono) and, within the sans, built from weight and tracking rather than from a third face.

### Hierarchy

- **Hero** (`text-hero` — 40 → 56px, weight 640, -0.03em, line-height 0.95): Moment pages only, where the heading IS the content and nothing dense sits under it: `/pricing`, the 404, the route error. Three call sites; if a fourth wants it, check §3's Page-Fit Rule first.
- **Display** (`text-display` — 30 → 40px, weight 640, -0.025em, line-height 1): An app page's title. Names the surface above dense material — add, official, compare, dashboard, auth.
- **Display small** (`text-display-sm` — 28 → 34px, weight 640, -0.02em, line-height 1.1): The same job for headings carrying strings we do not control — bundle names, `owner/repo`, empty-state titles. A step lower with more leading because those wrap.
- **Headline** (SN Pro 600, 1.875rem, -0.02em): Page and section headings.
- **Title** (SN Pro 600, 1.125rem): Card titles, panel headers.
- **Section** (SN Pro 600, 0.875rem, `text-foreground`): Named blocks inside a page — the `LabeledSection` heading, sidebar sections, comparison groups. A real heading element, sentence case.
- **Body** (SN Pro 400, 0.875rem, line-height 1.6): Default UI and prose; cap prose at 65–75ch.
- **Field label** (SN Pro 500, 0.75rem, `text-muted-foreground`): What names a column, a `dt`, or a value — table headers, stat cells, metadata. Sentence case, normal tracking.
- **Micro** (SN Pro 500, `text-micro` / 0.6875rem): Pills and dense chips only. The floor; nothing smaller.

### Named Rules

**The Page-Fit Rule.** A display size is right or wrong only relative to the
page under it, never on its own. Measure the type ladder of the actual page
before sizing its heading: `/pricing` carries a 30px price tier, so a 56px hero
has something to step down to; `/add` and `/official` are 12-14px throughout, so
the same 56px would open a gap with nothing in it. This is not theory — one
display step was applied to every page alike and `/add` measured 64 → 18 → 14,
a 4.6x jump straight from the title to the body. An app page title lands about
3x its body text; a hero can go further only where the page earns it.

**The Optical-Mass Rule.** When the face changes, the sizes do not carry over.
The 64px above was calibrated for Geist Pixel, which is mostly whitespace and
puts far less ink on the page than SN Pro does at the same nominal size. The
number survived the face swap untouched and every heading in the app became
enormous. Re-measure the scale against the page whenever the family, weight, or
tracking moves.

**The Built-Display Rule.** A one-family system has to BUILD its display end; scaled-up body text is what makes one look undesigned. Weight climbs to 640 and tracking tightens to -0.03em at hero sizes, because optical tracking runs opposite to size — what reads as open at 14px reads as loose at 64px. Both display steps ship their own size, leading, weight and tracking, so a call site is `text-display` and nothing else. This is not a style preference: the six near-identical arbitrary clamps that preceded the token, all spelling out `font-medium tracking-tight` by hand, are what it replaced. Never hand-roll a hero out of `text-5xl` plus weight and tracking classes.

**The Weight Ladder Rule.** Display 640, headline and title 600, section 600, body 400, labels 500. Weight only ever climbs with size. This is worth stating because the app once broke it invisibly: the display role sat at `font-medium` (500) while headline sat at 600, which was survivable only while display was a different family. The moment one face carries both, a 500 hero above a 600 subhead reads as less important than the thing under it.

**No second family for emphasis.** Mono is for machine strings (below); it is not a display option. If a heading needs more presence, it gets weight, size, or space — not a different face.

**The Sentence Case Rule.** Nothing in this interface is set in `text-transform: uppercase`. Not eyebrows, not table headers, not status pills, not section labels. Wide-tracked capitals are the default costume of a generated dev-tool UI, and a small caps label is also the least legible way to set the smallest type on the screen. A word that arrives from an API as a raw enum (`warn`, `HIGH`) is normalised to sentence case before it is rendered — see `formatVerdict` in `components/monitoring/condition-meta.ts`. Literal machine constants that are genuinely written in caps (`500 INTERNAL_ERROR`, `SKILL.md`) are quoted as-is, in mono; that is content, not a type treatment.

**The Mono-Is-Data Rule.** Google Sans Code means "this is a machine string you could copy": install commands, code and `<pre>`, file paths, `owner/repo` identifiers, version strings, diff `−`/`+` markers, error digests. It is not a way to make a label look technical. Two consequences worth stating, because both were violated across the app: a label never gets mono just because it sits near data, and a metadata line like "42 skills · 1.2k installs" gets `tabular-nums` — which is the actual requirement, stable digit widths — not `font-mono`, because it is a sentence with numbers in it.

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

A section that is a link target takes `scroll-mt-24` so the floating header pill (which ends at 72px)
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

**The Light Ceiling Rule.** Light mode has only three tonal steps: `--surface-1` (0.97), `--surface-2` (0.985), and `--surface-3` (1.0). Levels **4 through 8 are all `oklch(1 0 0)`** — the same white as level 3. Lift above 3 comes entirely from shadow there, which is exactly what §5's opening says, but the consequence is easy to miss: **a nested element cannot separate from its parent by fill alone unless the parent is `surface-1` or `surface-2`.** A `bg-card` list inside a `level={5}` sheet is white on white in light and invisible; dark hides the mistake, because there the ladder really does step at every rung — and hides it backwards, since the nested fill lands DARKER than the surface under it, the inverse of the same pair on the page. Two ways out, and the catalog row uses both. Separate with a **hairline**, which needs no tonal room at all — `rowPositionClassName` welds the rows into one stack whose seams read on the page and inside a sheet alike. Or step the child **down** rather than up, the one direction light leaves open — `LIST_ROW_ON_RAISED` drops the row to `muted` so the list still has a silhouette against a white sheet once the stack's outer border is gone. What does not work is stepping up, which is the trap: it looks correct in dark right up until someone opens the same component in light.

One exception exists and it is deliberate, so do not "correct" it: the header pill is **flush**, not raised. Its whole edge is one token, `--chrome-shadow`, rather than a surface level paired with its matching `SURFACE_SHADOW_COMBINED[N]`. In light that token is just `--surface-shadow-1`, the ladder's hairline-ring-no-drop level. In dark it stops being an alias and carries the edge alone — a hairline outside plus a specular on the top inside — because `--surface-shadow-1` is transparent there.

Those two dark layers exist for one reason: the ladder's ring and rim assume a fill **lighter** than the page, and the chrome surface (§2) is darker than it — so the ladder's ring lands lighter than the fill it is meant to define, and the boundary blurs instead of sharpening. (In light there is nothing to displace: every `--surface-rim-N` is already transparent there.) `app/globals.css` records what the pill's own edge measures, and says why a ladder comparison is not recorded alongside it.

## 6. Shapes

One radius variable drives everything. `--radius: 0.75rem` (12px) is the root,
and every step is computed from it (`--radius-xs` = root − 6px through
`--radius-5xl` = root + 12px), so retuning the whole form language is a one-line
change and no component carries a hardcoded corner.

### The radius scale

| Token          | Value  | Where                                                                                                                                                                                                                                  |
| -------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rounded-sm`   | 8px    | Nested chips, inline code                                                                                                                                                                                                              |
| `rounded-md`   | 10px   | Badges, `xs` buttons                                                                                                                                                                                                                   |
| `rounded-lg`   | 12px   | Buttons, inputs, list rows. The default.                                                                                                                                                                                               |
| `rounded-2xl`  | 16px   | Cards and panels                                                                                                                                                                                                                       |
| `rounded-5xl`  | 24px   | The header pill, and nothing else. Off the 2px cadence on purpose — it exists so that corner stays derived rather than hardcoded. Its controls sit 12px inside it, so their `rounded-lg` is 24 − 12 and the curves read as concentric. |
| `rounded-full` | circle | Avatars, dots, the status light ring, icon-only controls                                                                                                                                                                               |

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
- **Loading:** swaps a section for `Spinner` (§7 Signature). One indicator, everywhere.

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

### The loading indicator

`components/ui/spinner.tsx` is the app's ONLY loading indicator, everywhere a
spinner would go. It replaced three hand-built dot-matrix loaders (`ripple`,
`comet`, and a `sweep` that nothing ever imported), which is the reason it is
specified here rather than left to each surface.

- HugeIcons `Loading02Icon` under `animate-spin`. It is the only loading glyph
  in the set that reads as spinning — one open arc with a rounded cap, so the
  gap gives the rotation something to track. The other four are an hourglass, a
  sundial and a progress bar, all identical at every angle.
- Stroke weight rises as the box shrinks (2.5 at `xs` down to 1.75 at `lg`).
  Optical correction, not decoration: the glyph ships at 1.5, and a 1.5 stroke
  on a 16px arc reads as a grey smudge rather than a line.
- Sizes are Tailwind classes, not inline width/height, so a caller's
  `className` can override through `cn`'s tailwind-merge. The loader this
  replaced set inline styles, which silently beat the `size-4` one call site
  was passing.
- `role="status"` + `aria-live="polite"` + an `ariaLabel`, and
  `motion-reduce:animate-none` so the arc holds still rather than disappearing.

## 8. Do's and Don'ts

### Do:

- **Do** keep Signal Blue (`oklch(0.6 0.2 250)`) rare: primary action, active state, focus, links. One signal per screen.
- **Do** tint every neutral toward `hue 270` at `chroma 0.004`; never use pure gray.
- **Do** use `surface-N` levels for any raised element so light and dark depth stay coherent.
- **Do** keep Ink Muted (`oklch(0.5 ...)`) for secondary text; verify ≥4.5:1 before lightening anything.
- **Do** reach for `text-display` / `text-display-sm` for a hero rather than assembling one from size, weight and tracking classes.
- **Do** use `Spinner` for every loading state. There is one indicator.
- **Do** give an unresolved state its own tone. Never let "not checked yet" or
  "nothing here" fall through to the success colour.
- **Do** hold layout height across a loading→resolved transition; a placeholder
  that occupies no space makes every row jump when data lands.
- **Do** keep transitions fast (100ms `ease-out`) and let the 0.98 active scale carry the press.

### Don't:

- **Don't** use gradient hero blobs or any `background-clip: text` gradient text. The accent is a single solid color.
- **Don't** use decorative glassmorphism; blur and glass are not the default surface.
- **Don't** add a second font family. The display end is weight and tracking.
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
