# Charts

The three charts and the TanStack Charts integration behind them. Keep this in
sync with `components/charts/` and the three chart components
(`components/skill-install-sparkline.tsx`,
`components/skill-install-chart.tsx`, `components/compare-trend-chart.tsx`)
when behavior changes.

Most of this file is a list of things that are easy to get wrong and were got
wrong at least once. Each entry states the trap and the measurement behind it,
so the code can stay short and point here.

## Overview

Three charts, all built on **TanStack Charts** (`@tanstack/charts`): the sidebar
sparkline, the install-history dialog chart, and the compare page's multi-line
chart. Shared pieces live in `components/charts/`; each chart file owns its own
`defineChart` definition.

Styling for the library's own nodes — the grid rules, the axis labels, the bar
and line hover dim, the entrance wipe — is in `components/charts/charts.css`,
imported by `charts/chart.tsx` so it travels with the charts. It is deliberately
NOT in `app/globals.css`. Those selectors reach markup the library renders and
we never author, which is the one thing a utility class cannot do; anything that
can be a utility still should be.

The library ships its own docs and skills inside the package —
`node_modules/@tanstack/charts/docs/` and `.../skills/`, indexed by `llms.txt`.
**Read those rather than relying on memory or a docs mirror**; they match the
installed version, and this is a young library that moves.

## Traps

Things that are easy to get wrong, all of which were. Grouped by what you are
doing at the time:

- [Composing a definition](#composing-a-definition) — marks, `z`, the host props
- [Scales, axes and grid](#scales-axes-and-grid) — domains, ticks, curve
- [Measurement and coordinates](#measurement-and-coordinates) — scene units vs CSS pixels, when the chart measures
- [Pointer, touch and keyboard](#pointer-touch-and-keyboard) — who owns the gesture, focus control
- [Motion](#motion) — what springs, what steps, what is CSS
- [The cursor](#the-cursor-rule-markers-band-pill-tooltip) — rule, markers, band, pill, tooltip

### Composing a definition

- **Charts are composed by spreading `chartHostProps` into `RendererChart`, not
  by a wrapper component.** A generic wrapper has to re-declare the datum and
  axis type parameters, and they collapse to `unknown` at the call site, which
  costs the typed `point.datum` in `renderTooltipBody` and `onFocusChange`.

- **`RendererChart` comes from `@tanstack/charts/react/tooltip`.** That is the
  only entry that takes both a `renderer` and `renderTooltipBody`.

- **Marks that should be read together at one x need distinct `z` values.**
  Grouped focus reduces points sharing a group to a single member, and the
  default group is `null` — so two ungrouped marks silently collapse to one,
  taking a tooltip row and the hover highlight with it. Nothing guards this;
  the definitions are built inside components, so there is no seam a unit test
  can reach.

- **`focusRing: false` on every definition.** The overlay draws the marker, so
  leaving the built-in ring on paints a second dot underneath it — and only
  ours moves, which reads as one marker lagging the other.

- **A `scale:` factory infers its domain; only a configured _instance_ keeps
  one.** `scale: () => scaleLinear().domain([0, max])` silently loses the zero —
  the arrow makes it a factory. Pass `scale: scaleLinear().domain([0, max])`.

### Scales, axes and grid

- **The line curve is monotone, not the old chart's `curveNatural`.** Every
  series here is a cumulative install count, and a natural spline overshoots
  each vertex. Measured on the old chart, on a skill whose totals never fall
  once: a third of the drawn line descends, it peaks 21% above the value it
  actually reached, and it dips 18 units below the lowest figure ever recorded.
  That is the chart contradicting its own numbers. `curveMonotoneX` is the same
  soft cubic and cannot leave the data's envelope — measured 0 units above the
  highest point and 0 below the lowest on both charts.

- **Give a cumulative y axis an explicit zero-based domain.** Left to infer,
  the scale starts near the smallest series and exaggerates the gaps between
  them. The old chart used `[0, max * 1.1]`; `compare-trend-chart.tsx` restates
  it. This is also why the sidebar sparkline plots `installs - min` rather than
  the raw total — against a zero-based axis a cumulative count is a flat line.

- **Every x scale is a point scale, including the install chart's.** It puts
  the first and last day ON the plot's edges, so the line, its marker, the
  crosshair, the pill and the labels all share one x. A band scale insets the
  first and last column by half a band, which at six points leaves the axis
  ~55px short at each end and the cursor nowhere near the label naming it. The
  old chart ran two scales at once — bars on a band, line and labels on a time
  scale — so ITS bars sat up to half a band from their own labels; one scale is
  that look without the disagreement. Shifting only the labels (a `tickLabels.dx`
  offset) was tried and is worse: the labels then align with nothing.
  The cost is bar width. Off a band the mark has no bandwidth to read, so
  `inferBandwidth` gives it `minimumSpacing * 0.8` — a ceiling, since `inset`
  clamps at zero — against the old chart's 0.88 of the column. Measured at 45
  points: 10.3px wide on a 12.8px pitch, about a pixel under the old.

- **Date axes thin by `tickLabels.thin.minGap`.** Point and band scales offer
  every category as a candidate and ignore `count`/`spacing` hints, so left
  alone they print one label per row that fits — nearly twice the old chart's
  `numTicks`. `evenlySpaced` picks the candidates instead (5 in the dialog, 6 on
  the compare page), and thinning runs on top as the backstop.

- **Thinning is a backstop, not a narrow-width strategy — it drops candidates
  greedily, not evenly.** Ask for more labels than fit and what survives is
  whatever cleared `minGap` on the way through, which on a time axis states a
  spacing the data does not have. Measured on the compare chart at 390px: six
  candidates over a 306.86 scene, thinned to Jul 31 / Aug 13 / Aug 21 —
  thirteen days, then eight. The fix is to ask for fewer up front, which is
  what `defineChart`'s responsive builder is for: `compare-trend-chart.tsx`
  takes `({ width }) =>` and drops to four candidates below a 480 scene width,
  so thinning never fires. Verified at 390 / 640 / 768 / 1440: even 7-day steps
  narrow, the full six above.
  Read the width off the **scene**, not the viewport — the card is the box the
  labels have to fit in, and the builder is handed exactly that.
  The install chart's axis is not evidence that thinning preserves spacing. It
  asks for five over the same range, `evenlySpaced` hands back four because 21
  divides by three, and all four survive; it is even by luck.

- **`ticks.count` is a preference d3 rounds, not a count.** On the dialog
  chart's domain, 5 asks yields 8 grid rules and 3 yields 5. Where the numbers
  are never read — the install chart's y axis describes neither series on its
  own — pin the domain and pass explicit `values`, which is exact and stable
  across data.

- **The install chart's top grid rule sits at the domain ceiling**, on the
  plot's top edge — where the old chart drew its fifth rule too. Dropping it was
  tried, to stop a curve overshoot crossing a rule, and rejected: with the
  remaining four evenly spaced and exactly one slot of empty plot above them, it
  reads as a missing line. The overshoot itself is gone (see `CHART_CURVE`), so
  the ceiling rule is no longer something the data crosses.

- **Grid stroke style is CSS, not definition.** `grid` is a boolean and the
  theme carries only a color, so the dash pattern and the opacity reset live in
  `charts/charts.css`. The reset matters: the renderer draws grid rules at
  `stroke-opacity: 0.11` over a `--border` that is itself ~10% opaque, and the
  two multiply out to invisible.

### Measurement and coordinates

- **Scene units are not CSS pixels.** The chart lays its scene out in its own
  coordinate space and lets the viewBox scale it to the container, so the two
  part company whenever the scene was laid out at a width the chart is no
  longer painted at. Anything in the overlay's SVG inherits that viewBox and
  needs no conversion, but the date pill and the tooltip panel are HTML
  positioned in `left`/`top`, and reading scene units into those puts them
  further and further behind the cursor toward the right edge. `pxPerUnit` in
  the overlay converts; it is measured off the painted SVG, NOT derived from
  `scene.width`, which is the scene's own width and not what it paints at.
  They now coincide on all three charts (see the next entry), so nothing
  exercises the conversion — do not conclude from that that it is dead.

- **The chart measures its container with `getBoundingClientRect`, and only
  ever re-measures when its ResizeObserver fires.** A transform changes no
  layout box, so an entrance animation defeats both halves of that: mounted in
  the install dialog while it still opened with `scale-95`, the chart measured
  592.8 against a 624px container and had no way to notice. Our own code is
  warned off `getBoundingClientRect` during an entrance further down; this is
  the library doing it, and it cannot be told not to. Two symptoms, both
  measured: the library's own tooltip positions from scene coordinates without
  converting and drifted left by up to 31px (flush against the marker on the
  right, ~45px of gap on the left), and the viewBox — which is what maps scene
  units to pixels — carried the error into every stroke width, tick font and
  marker radius, painting them 5.3% oversized.

  **The fix is upstream of the chart: the install dialog's transition carries
  no scale.** `skill-record.tsx` neutralises `data-starting-style:scale-95`,
  leaving translate and opacity, neither of which changes a measured width. The
  chart then lays out once, correctly, and never relayouts — verified across
  two opens and at phone width, where the only viewBox the SVG ever carries is
  the container's own (624 desktop, 300 at 390px). That comment in
  `skill-record.tsx` is load-bearing; restoring the scale silently brings all
  of this back.

  Two approaches were tried first and are worth not re-deriving. A measured
  `width` prop is worse: `width` means the application owns fixed geometry, so
  the host is pinned in pixels, and in a grid item at its default
  `min-width: auto` that pins the very track the chart is measuring — the
  compare chart could then never shrink on resize. And a `useSettledBox` hook
  (deleted in the same change; see git history) polled until the painted box
  matched the layout box and then rebuilt the definition to force a re-measure.
  That works, but the correction is itself a visible snap — one frame at
  ~170ms where the whole scene rescales 5.3% — so it also had to hold the
  chart's paint behind an opacity fade until then. Removing the scale removes
  the need for either.

  What replaced it is `useUntransformedHost` (`charts/chart.tsx`), a dev-only
  warning rather than a repair: it names the chart, prints the two widths and
  the error, and points at the mount site. That is deliberate. A hook that
  quietly corrects a scaling ancestor is a hook that hides a design mistake and
  charges a paint delay for it; the mistake is worth seeing. Verified both
  ways — silent as things stand, and on restoring `scale-95` it prints
  "painted 592.8px against a 624px layout box … paints 5.3% off".

- **Pass `initialWidth`.** The adapter renders its first markup at that width
  (default 640) and measures the container only after commit, so everything in
  scene units — stroke widths, marker radii, fixed margins — is scaled by the
  ratio until it re-lays-out. A 240px sparkline drawn first at 640 paints a
  hairline, then visibly thickens. `INITIAL_WIDTH` in `charts/chart.tsx`.

- **Do not measure chart geometry with `getBoundingClientRect` during an
  entrance.** It is screen space, so it carries any transform an ancestor is
  mid-animation on: taken while the dialog was still scaling open, every tick
  centre came out ~20px adrift and the wrong label faded. The label's own `x`
  times `pxPerUnit` is transform-proof, and so is `clientWidth`.

- **`onRender` runs before the markup it describes is in the DOM.** Anything
  reading the rendered axis — the tick geometry the fade needs — has to wait a
  frame or it measures the PREVIOUS render. Only bites where data arrives late:
  the compare page laid out its labels on a pass nothing re-measured, so its
  labels never faded while the dialog chart's did.

### Pointer, touch and keyboard

- **`onFocusChange` fires on every committed prop set, not only when focus
  moves.** Feeding it straight into `setState` is an infinite render loop;
  compare against the last value first (see `skill-install-sparkline.tsx`).

- **A re-render of the chart's parent cancels any in-flight focus animation.**
  Every React commit re-pushes props to the chart host, which repaints and
  drops the running spring, so the focus dot jumps instead of travelling. Any
  state a chart feeds back into the page (the sparkline's hovered day) must not
  re-render the chart: keep its props referentially stable so the component
  bails out. `weekWindow()` returning a fresh slice each render was enough to
  break it.

- **`resolvePointer` answers from anywhere in the element**, including the axis
  gutters — it does not know where the plot is. Without the bounds check in
  `inspect` the cursor and tooltip appear while the pointer is down among the
  tick labels, well below the chart.

- **Keyboard focus is a second input, and the overlay has to be told about it.**
  `pointer: false` stops the chart's pointer handling only — arrow-key
  navigation stays live, so tabbing to the chart moves its focus, dims the
  unfocused bars (a mark state it applies itself) and paints nothing else. The
  bridge is `onFocusChange`, which reports only the PRIMARY point; the group it
  belongs to is rebuilt from `scene.points` by matching `xValue`, because the
  panel needs a row per series. Guarded against the pointer path repainting
  twice by the same `lastFocus` datum check.

- **The overlay owns the pointer gesture (`pointer: false` on every
  definition).** The chart's own handling is hover-shaped — focus on move,
  clear on leave — and touch has no leave: a tap paints focus that then sits
  there, and a drag gets claimed by the browser as a scroll. The overlay maps
  each input to what it means (a mouse inspects on hover, a finger only while
  it is down) via `interaction.resolvePointer` / `setControlledFocus`, and the
  wrapper carries `touch-action: pan-y` so horizontal drags are ours.

- **A captured touch keeps the chart until it lifts.** The plot-bounds check is
  for a hovering mouse; applying it to a drag is what made the cursor vanish the
  moment a finger strayed below the plot. On the old chart you could drag off
  the chart, off the dialog, and keep scrubbing.

- **Do not call `setControlledFocus` when focus has not moved.** It repaints the
  whole scene and restarts every mark-state transition, so calling it per
  pointer move retargets the bars' 120ms fade every frame: the fade never runs
  and reads as though it has none. Everything the overlay draws is anchored to
  the focused point rather than the pointer, so a move within one column has
  nothing to redraw anyway.

- **The chart SVG carries `tabindex="0"`, and the browser ring around the whole
  plot is suppressed in `charts/charts.css`.** The chart paints its own, far
  more precise focus state (rule, marker, tooltip, dimmed bars), so this costs
  no accessibility — but only because that state is durable. It was not:
  `onPointerLeave` cleared everything, and a mouse leaving says nothing about
  where keyboard focus is, so tabbing in and then sweeping a mouse across the
  chart and away left it focused with nothing drawn. The guard in
  `use-chart-hover-overlay.ts` holds the paint while the SVG is
  `:focus-visible`. Remove that and the ring has to come back.
  The guard rests on a measured fact, and an earlier version of this line
  asserted its opposite: a plain click leaves the element `:focus` but NOT
  `:focus-visible`, while Tab sets both. That is what lets one selector
  separate a mouse user (still gets the clear) from a keyboard user.

- **The library's focus guides do NOT wedge under a fast pointer.** This file
  claimed they did, and that was the stated reason for hand-rolling the cursor.
  Measured against our own rule through a fast scrub: 80 distinct positions in
  90 frames versus 89, ending 5.8 units apart. The original freeze was
  self-inflicted — `setControlledFocus` on every pointer move cancels the
  in-flight animation, the same bug that later stopped the bar fade completing
  (see the note on not calling it when focus has not moved).

### Motion

- **The guide runs on the renderer's motion, not the overlay's.** Two
  consequences: hand it `FOCUS_SPRING` or it drifts from the marker it shares an
  x with (~4px mid-travel on the renderer's default), and gate it separately at
  `DISCRETE_THRESHOLD` — the overlay's `jump()` writes cannot reach it.

- **Two entrances, deliberately different.** The compare chart's is ours: a
  `clip-path` wipe on `.ts-chart__marks` (`.chart-reveal` in
  `charts/charts.css`), immune to what the renderer commits, which is what a
  chart on a page that can relayout under it wants. The install chart's is the
  library's (`chartMotionEntrance`, `initial: "always"`), which grows the marks
  from the y baseline staggered left to right and settles ~720ms in; it can
  only be used because its dialog does not scale (see the measurement section).
  The shared `chartMotion` stays `initial: false` so the sparkline gets neither
  and the compare chart does not play both.

  The split is not just what each surface allows, it is what each chart means.
  A wipe travels along x, so it reveals a time series in the order the data
  happened — which on the compare chart is also the order its lines cross each
  other, the whole point of putting them on one axis. A baseline grow travels
  along y, which reads as magnitude; that is the install chart's daily bars
  exactly, and the stagger still carries the left-to-right reading. Swapping
  them would give each chart the other one's metaphor.

  The compare chart could take the library entrance — measured, it mounts once
  at its final width (a single viewBox of 1206.86 from first paint, because the
  ghost placeholder holds the slot until the data lands, so the real chart never
  mounts hidden or empty). It should not. Its definition is rebuilt from a memo
  over async data that has already caused a full re-layout once (see the
  comment on `series` in `compare-content.tsx`), and any re-layout inside the
  entrance's first ~720ms is a `resized` commit that cancels it with no trace.
  The dialog chart cannot hit that: it mounts with its data already in hand and
  nothing re-renders it. Robust entrance where re-renders are possible, library
  entrance where they are not. Everything else — crosshair, focus dot, highlight band, tooltip
  travel — springs through `@tanstack/charts/motion`. If chart motion looks
  dead, check the two entries below before reaching for Motion: both look like
  "the renderer is not animating" and neither is.

- **There are two animation systems and you can only have one.** The default
  SVG renderer animates from `svgAnimation` on the definition; the optional
  `motion()` renderer animates from its own options and **ignores
  `svgAnimation` entirely** — "each host has one animation owner"
  (`docs/examples/themes-and-motion.md`). Traced: `renderer.js` folds
  `svgAnimation` into an `animation` option, and only `svg-surface.js` and
  `canvas.js` read it; `motion.js` never mentions it. All three of our charts
  pass `motion()`, so any `svgAnimation` we wrote would be live-looking dead
  config. Its resize half has an equivalent we DO have — `motion({ resize: true })`,
  default false — and we deliberately leave it off: it animates size changes,
  and a chart that eases behind a container is lag, not motion. It is there for
  a size change that is itself a designed transition (a panel expanding), not
  for tracking a window. The library's own reason is sharper than that one:
  "`resize`: defaults to `false`, so responsive relayout does not repeatedly
  restart animation" — during a drag every event retargets the tween, so it
  never arrives.

- **Window resizing needs nothing from us.** Omit `width` and the host reads the
  container's bounding width and observes it with a `ResizeObserver`, schedules
  relayout on the document's animation frame, and skips renders when the width
  has not changed (`docs/reference/dom-host.md`). The fallback order is explicit
  `width`, then a positive container width, then `initialWidth`, then 640. The
  one thing it asks of us is that the container can actually shrink —
  `min-width: 0` on a grid or flex child — which is the same constraint that
  rules out passing a measured `width`, above. Measured on the compare chart at
  1440 / 1100 / 820 / 560 and through a fast six-step sweep: the viewBox tracks
  `clientWidth` exactly every time.

- **The bars' entrance stagger is ours, because the library's is derived from a
  duration a spring does not have.** `resolveTiming` spans the automatic bar
  stagger over `baseDuration * 0.4`, and `baseDuration` is the tween's duration
  or a flat 1100 for a spring — ours is `FOCUS_SPRING`, so the span was 440ms
  and the only way to shorten it was to change the renderer's transition, which
  also feeds the tooltip. `skill-install-chart.tsx` authors the delay instead
  (`ENTRANCE_STAGGER_MS`, 180). Measured: the last bar used to start at 440ms
  and reach 99% at ~690; it now starts at 176ms and reaches 99% at 442.
  Divide by `datumCount`, as the library's own does. `stagger()` from
  `@tanstack/charts/motion/definition` writes a flat milliseconds-per-datum,
  which is linear in series length — a 200-snapshot skill would sweep ten times
  longer than a 20-snapshot one instead of taking the same span.

- **`initial: false` is not just to avoid a double entrance — the library's own
  entrance cannot survive a container-measured chart.** `motion.js` gates it
  `animate = initial ? motion.initial : motion.resize || !resized`, and the
  adapter always prerenders at `initialWidth` and then measures, so the first
  real measurement is a `resized` render: with the default `resize: false` it
  commits instantly and cancels the entrance. Measured with `initial: true` on
  the install chart: the bars sit at height 0 for 130ms and then snap to their
  full 152px in a single frame, having animated nothing. Matching
  `initialWidth` to the container's `clientWidth` does not rescue it — the
  dialog's ease-out asymptote left 623.51 on the prerender and 623.77 a frame
  later, and 0.26px still counts as `resized`. `resize: true` would tween that
  correction rather than snap it, but the renderer is shared by all three
  charts, so it would also interpolate the whole scene behind every window
  resize. The CSS wipe has none of these couplings: it is a `clip-path`
  animation and does not care what the renderer commits.

- **The hover dim is a CSS transition, not renderer motion.** The renderer
  re-resolves and re-animates every mark state on each focus change, restarting
  from the live DOM value, so during a scrub a bar the cursor has already left
  is handed a fresh tween every column and never arrives: measured mid-drag it
  decayed 1 → 0.86 → 0.63 → 0.48 → 0.45 and levelled off, where the old chart's
  reached 0.3 in 123ms and stayed. A CSS transition ignores a write that does
  not change the target, which is what the old per-bar Motion `animate` did.
  The states write instantly (`NO_MOTION`) and `charts/charts.css` owns the ramp.
  Note which channel each dim uses: `fillOpacity` for the bars, `strokeOpacity`
  for the line. The overlay's highlight band is cloned from the live line, so it
  has to strip BOTH — when the line dim moved from `opacity` to `strokeOpacity`
  the clone kept inheriting 0.5 and the bright segment came out as a half-
  strength wash of the series colour.

- **The tooltip panel is the library's, and it neither eases nor enters.**
  Measured: one column step moves it through exactly 2 positions, and a sweep
  across 13 columns through 14 — one per column, no interpolation — while it
  appears at full opacity with no transform. `tooltip.motion` does not change
  this and was tried; `placeTooltip` writes `style.left` directly, and with
  `pointer: false` the anchor is the focused datum's own scene coordinate,
  which is discrete. Our markers still spring, so the dot glides between
  columns while the panel steps.
  This is the one thing the swap cost. The old `TooltipBox` faded its wrapper
  over 100ms while the panel inside scaled from 0.85 and slid 20px in from
  whichever side it had flipped to, and faded out on exit, off its own
  MotionValues (`panelOpacity` / `panelScale` / `panelSlide`) rather than the
  shared `opacity`, which still cuts instantly for the rule and the dots as it
  always did. If it is wanted back, the entrance is reachable in CSS without
  taking the positioning back: the extension sets `data-placement` on the
  panel, so a keyframe can slide it in from the correct side.

- **Mark states cannot animate from an absent attribute.** A state that sets
  only the dimmed value leaves the focused node with no attribute at all, so
  the renderer has no `from` to tween: the dim lands in one frame and the
  transition is silently ignored, which reads as transitions being unsupported.
  Give the mark the same channel at full strength (`fillOpacity: 1`,
  `strokeOpacity: 1`) and write the state in that channel rather than
  `opacity`. Measured: 119ms for a 120ms tween once both ends exist.

- **Above 60 points only the crosshair rule and the pill stop animating**
  (`DISCRETE_THRESHOLD`, the old chart's `discreteInteraction`): the rule jumps,
  the pill jumps, and the ticker swaps its label instead of scrolling. The
  markers, the highlight band and the tooltip panel keep springing at any
  length. The old chart gated exactly three things — `TooltipIndicator animate`,
  the pill's `left`, the ticker's compact form — and neither `TooltipDot` nor
  `SeriesHighlightLayer` was one of them; the band lived in the line layer and
  took no `animate` flag at all. Measured on the live old chart at 64 points:
  the marker travels 17 distinct positions between two columns and the band's
  clip rect 17. Stilling everything is the obvious reading of that flag and it
  is wrong — and the gap only shows on data long enough to trip it, which dev
  seeds rarely are.

- **A Motion spring configured `{ duration: 0, bounce: 0 }` still animates.**
  It reads like "settle immediately" and does not: measured under
  `prefers-reduced-motion: reduce`, the focus dot travelled four intermediate
  positions. Instantaneity is decided per write with `jump()` instead, which is
  why the overlay has both `write` and `writePill` — the pill also jumps on
  touch, where easing under the finger reads as lag rather than motion.

- **A MotionValue event only fires when the value CHANGES, and only reaches the
  callback from the last render.** Both halves bite here. `updateAndNotify`
  skips the notify when the new value equals the old, so writing a datum's
  index into a value that already holds it paints nothing — which is what left
  the compact date pill blank when the first hover of a long series landed on
  column 0 (`CompactLabel` now seeds itself from `dayY.get()`). And
  `useMotionValueEvent` re-subscribes only when the callback identity changes,
  which takes a render; the overlay deliberately does not render while the
  pointer moves, so a listener closing over anything mutable can be a focus
  change behind. Prefer writing the DOM from `showFocus`, which has the index
  in hand. (An earlier note here claimed the hook keeps its mount-time
  callback outright. It does not — `callback` is in its dependency array.)

- **The overlay writes only to MotionValues, never React state.** Putting any
  of it in state would re-render the chart on every pointer move and cancel its
  motion. Same reason the axis-label fade is an imperative write of custom
  properties, off geometry measured once per render: reading a box between
  style writes forces a reflow, and doing that per frame blows the frame budget
  on its own.

### The cursor: rule, markers, band, pill, tooltip

- **Every marker looks the same** — a disc of the series colour inside a ring of
  the surface. There is no per-mark variant; a hollow ring for lines was tried
  and rejected.

- **The tooltip panel wears the tooltip component's `chrome` variant**
  (`bg-chrome` + `data-surface="chrome"`), not a surface tier. A series painted
  in a page tone disappears on it — the daily bars' neutral did — which is what
  `HoverMarker.swatch` exists for. The date pill is on the same surface, so the
  two read as one instrument; the old chart inverted the pill in dark
  (`dark:bg-zinc-100`) and this deliberately does not. Fill only on both —
  `--chrome-shadow` is the variant's opt-in edge, for a header bar rather than a
  label — except the pill keeps its own `shadow-lg`, which it needs because it
  sits on the plot.

- **Bar dimming is a mark state, not overlay work.** `BAR_UNFOCUSED_DIM`
  (`series-state.ts`) uses `when: { focus: "unmatched" }`, evaluated per datum,
  because bars are per-datum scene nodes. Lines are not — the whole path is one
  node — which is why their highlight goes through the overlay's cloned band
  instead. When checking this in the DOM, note that the focused bar has NO
  `opacity` attribute rather than `opacity="1"`.

- **The rule is the library's; the rest of the cursor is ours.**
  `focus-crosshair.ts` returns a `crosshair` mark — neutral, dashed, placed LAST
  in `marks` because mark order is paint order and earlier hides it behind the
  bars. Dots, highlight band, date pill and tooltip panel stay Motion, in
  `chart-hover-overlay.tsx`, because none is expressible as a guide: the band
  re-strokes the line through a moving window, the pill is a two-track ticker
  that overhangs the plot, and a guide's own label is clamped inside it.

- **`tooltip.offset` applies along the placement's primary axis.** `bottom-*`
  offsets vertically and leaves the panel horizontally flush with the cursor;
  `right`/`left` is what puts a gap beside it.

- **The tooltip is capped narrow.** `maxWidth: min(16rem, calc(50vw - 3.5rem))`
  in `chart-tooltip-panel.tsx`, so on a small chart the panel cannot approach
  the width of the plot. Do not "fix" the resulting overhang by centring the
  tooltip: following the cursor is the point, and hanging past the plot edge is
  fine.

- **The marker ring is the page tone (`--background`), not the tier the chart
  sits on.** It is a halo holding the dot off the line, so it has to contrast
  with the surface, not match it: handed the dialog's own `--surface-5` it
  vanished into it in dark. The old chart used `--chart-background` — white in
  light, near-black in dark — for the same reason.

- **The date pill hangs past the plot at both ends and nothing may clip it.**
  It stays centred on its column all the way across, as the old chart's did;
  clamping it inside decouples it from the mark it is labelling exactly where
  that mark is easiest to point at. What keeps the overhang from widening the
  page is the dialog and the card clipping their own overflow — verify at phone
  width when touching this, since an overhanging absolute child otherwise
  flicks a horizontal scrollbar mid-drag.

- **Both line charts fade at the plot's left and right edges** — the old
  `Line`'s `fadeEdges`, which defaulted to true, at the same 0/15/85/100 stops.
  The sidebar sparkline is the exception, as it always was (`fadeEdges={false}`
  there). The gradient is per series because a TanStack gradient carries its own
  colour; see `charts/fade-edges.ts`. The overlay's highlight band re-paints the
  cloned path with the series' solid colour, since inheriting the gradient would
  fade the bright segment out at exactly the ends where it is still describing a
  real point — the old chart handed `SeriesHighlightLayer` the raw `stroke` for
  the same reason.

- **The chart strips inline styles off its own nodes when it repaints**, and it
  repaints on every focus change. The node object survives, its `style` does
  not, so anything the overlay writes onto a tick label lasts about a frame.
  Two things it does NOT rewrite: a stylesheet rule, and a custom property
  inherited from an ancestor it does not own. The date-label fade uses both —
  one generated rule per label binding it to a `--tick-N`, and the numbers set
  on our wrapper as the pill moves (`paintTickFade`), reproducing the old
  chart's ramp: hidden within 10px of the pill's edge, back to full over the
  next 20px. That clearance is not cosmetic — the old chart hid everything
  within a flat 50px of the crosshair, and fading on centre distance alone
  leaves half a glyph poking out from behind the pill.
  Covering the labels with a strip of surface colour was tried instead and
  reads as a blank bar sweeping the axis; so does standing the whole row down,
  which the old chart did not do either.

## DOM coupling

`components/charts/chart-hover-overlay.tsx` is the only place that reaches into
the chart's rendered DOM (for the line's `d`, and to fade the axis labels the
date pill covers). That is real coupling to the library's output; it is
deliberate, because rebuilding the curve would not trace it exactly.
