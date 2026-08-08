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
  label:
    fontFamily: "var(--font-geist-mono), ui-monospace, monospace"
    fontSize: "0.6875rem"
    fontWeight: 500
    letterSpacing: "0.14em"
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
**Label/Mono Font:** Geist Mono (with `ui-monospace, monospace` fallback)

**Character:** A geometric, technical sans for everything functional, paired with a pixel-grid display face for headline moments and a true monospace for labels and data. The contrast is structural (sans vs. pixel vs. mono), not three competing sans-serifs.

### Hierarchy
- **Display** (Geist Pixel Circle, `clamp(3.5rem, 6vw, 5rem)`, line-height 0.95): Hero headlines and large brand moments only.
- **Headline** (Geist Sans 600, 1.875rem, -0.02em): Page and section headings.
- **Title** (Geist Sans 600, 1.125rem): Card titles, panel headers.
- **Body** (Geist Sans 400, 0.875rem, line-height 1.6): Default UI and prose; cap prose at 65–75ch.
- **Label** (Geist Mono 500, 0.6875rem, 0.14em tracking, uppercase): Eyebrows, metadata, table headers, small mono captions.

### Named Rules
**The Pixel Floor Rule.** Geist Pixel Circle collapses to ordinary mono below ~40px. Never set the display face below 60px; at small sizes it stops reading as pixel-grid and just looks like a broken mono. Display is for hero scale only.

**The Mono-Label Rule.** Uppercase + wide tracking is reserved for short mono labels (≤4 words): metadata, table headers, eyebrows. Never set body copy in uppercase.

## 4. Elevation

Depth is a first-class system, not an afterthought. Eight surface levels (`surface-1`–`surface-8`) each combine three things: a tonal background that lightens as it rises (in dark mode) or stays near-white (in light mode), a layered drop shadow (`--surface-shadow-N`), and an inset rim highlight (`--surface-rim-N`) that simulates a lit top edge. The result is tactile but quiet; elevation reads as material, not as a glow.

In light mode, lift comes mostly from shadow over a near-white surface. In dark mode, lift comes mostly from the tonal step plus a subtle top-edge rim, with shadows kept soft. Components opt into a `level` (background tier) and `shadowLevel` (shadow tier) independently.

### Shadow Vocabulary
- **`--surface-shadow-1`** (`0 0 0 1px ring`): Flush elements; a hairline ring with no drop. Default card shadow level.
- **`--surface-shadow-3`** (ring + near + mid layers): Resting cards and popovers.
- **`--surface-shadow-5`–`8`** (progressively deeper, longer-throw layers): Dialogs, menus, and overlays. The higher the level, the more ambient the far shadow.

### Named Rules
**The Material Depth Rule.** Shadow level and surface level are tuned together so a raised element looks lit, not pasted. Never hand-roll a `box-shadow`; use a `surface-N` level so light and dark stay coherent.

## 5. Components

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
- Neutral by default, Signal Blue marks the active item. Mono labels for section headers; sidebar uses `surface-1` with a hairline border. Collapse the sidebar at small breakpoints rather than reflowing type.

### Status light and condition vocabulary

The monitoring surfaces (the dashboard change panel, the bundle register) share
one state readout, and it is system rather than local — a third surface must
reuse it, not reinvent it.

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
- Header cells take the mono label treatment (§3), not the component default.
- At narrow widths drop trailing columns and fold their content into the primary
  cell. Never leave a column parked off-screen behind a horizontal scroll: the
  column the reader came for is the first one to disappear that way.

### Signature: Dot-Matrix Ripple
The loading indicator (`DotMatrixRipple`) is a grid of dots that ripple in sequence, echoing the Nothing OS dot-matrix motif. It is the project's loading vocabulary everywhere a spinner would otherwise go.

## 6. Do's and Don'ts

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
- **Don't** use uppercase for body copy; reserve it for short mono labels (≤4 words).
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
