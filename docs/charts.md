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
- [Loading and empty states](#loading-and-empty-states) — why the chart is its own skeleton

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

- **Two entrances, and which chart gets which is decided by its marks.** The
  compare chart's is ours: a `clip-path` wipe on `.ts-chart__marks`
  (`.chart-reveal` in `charts/charts.css`), applied when `loading` ends so it
  belongs to the real series arriving. The install chart's is the library's
  (`chartMotionEntrance`, `initial: "always"`), which grows the marks from the
  y baseline staggered left to right and settles ~720ms in. The shared
  `chartMotion` stays `initial: false` so the sparkline gets neither.

  The split is not taste, it is what the renderer can reach. Bars are per-datum
  scene nodes, so it can stagger them along x; a line is ONE node, so there is
  no per-datum handle and the automatic stagger is gated to `role === "bar"`
  anyway. Shipping the library entrance on the compare chart was tried and
  measured: the path is full width on its very first frame
  (`widthEverPartial: false`) and only its height grows, over ~90ms. No travel
  along x at all — which on a multi-line time series is also the order the lines
  cross each other, the whole point of putting them on one axis. The wipe is the
  only entrance that reads that way, which is why it stays.

- **The library's entrance fires on a host's FIRST render and nothing replays
  it** — not a definition change, not a prop change. So it cannot serve as a
  loading→ready reveal on any chart: to get it there the host has to remount,
  which throws away the single instance at exactly the boundary the placeholder
  architecture exists to bridge. Tried, measured, and reverted; the wipe needs
  no remount because it plays off a class on a host that stays put.

- **Everything else — crosshair, focus dot, highlight band, tooltip travel —
  springs through `@tanstack/charts/motion`.** If chart motion looks
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

### Loading and empty states

- **The library has none, and should not.** No `loading`, `pending`,
  `skeleton`, `empty` or `placeholder` concept exists anywhere in its docs or
  its twelve bundled skills, and the React adapter says outright that "there is
  no placeholder-only server mode". It is a rendering grammar; this is the
  application's job. Do not go looking for a prop.

- **One chart instance spans loading and loaded — do not swap it for a
  spinner.** The compare page used to `Crossfade` between a `DotMatrixRipple`
  skeleton and the chart, which cost the best thing the loaded state has: with
  the chart mounted, new data is a keyed update, so the y scale tweens (the
  lines only morph when the geometry stays compatible — see below). Tear it down and every arrival is a fresh mount. The symptom
  was that removing a skill and adding it back animated beautifully (React
  Query had that combination cached, so `isPending` stayed false and the chart
  survived) while adding a new one did not. Both reference libraries reach the
  same conclusion from the other side: bklit's `status="loading"` drives "one
  `Grid`, one `Line`, no component swap", and evilcharts describes its own
  Recharts twin unmounting series during loading as the inferior version.

- **Two waits, two treatments, neither of them a swap.** First fetch:
  `skeletonSeries` in `compare-trend-chart.tsx` builds placeholder rows under
  the real series keys, so the arrival is a keyed update rather than a mount.
  Column change with a chart already on screen: `placeholderData: keepPreviousData`
  on the insights query keeps the previous rows, the chart is never torn down,
  and it dims (`opacity-55`) while the new ones fetch — the same dimmed-filler
  reading the catalog uses. Measured on an uncached third skill: the chart is
  present in every frame, a line path is added, and the y axis walks
  `0–500k` → `0–2M` through an intermediate scale. The LINES do not travel with
  it; see the next entry.

- **Adding a skill snaps the lines, because it changes the shared date range.**
  The renderer "morphs compatible numeric SVG geometry", and compatible means
  the same command count. `buildCompareRows` builds the x axis from the UNION of
  every drawable series' days, so a skill whose history starts earlier inserts x
  positions into every other line: measured on one add, 22 path commands to 30
  as the range went Jul 31–Aug 21 to Jul 23–Aug 21. The path's `d` then changes
  exactly once, in a single frame, while the grid tweens across ~48 frames
  underneath it — a gliding axis under jumping lines, which reads worse than
  either would alone.
  It is not caused by the entrance choice: measured identical under the wipe.
  The only fix that would make it morph is a fixed x window rather than a union,
  so the command count never changes — which truncates the history of whichever
  skill reaches furthest back, and is a product decision rather than a repair.
  Do not diagnose this from path COUNT or from y-tick variants; both change on a
  snap too. Sample the first path's `d` per frame and count how many times it
  changes: one means a snap, dozens mean a morph.

- **The placeholder conceals before the real series is revealed — it does not
  morph into it.** bklit's loading→ready order, and the reason to prefer it over
  the renderer's morph is not motion but meaning: a morph says these are one
  measurement changing, and one of them is invented. `CompareTrendChart` runs a
  three-phase machine (`loading` → `concealing` → `ready`) whose middle phase
  exists only to hold the PLACEHOLDER's definition open while it clears. Swap to
  real rows on the frame the data lands and the renderer morphs, which is the
  thing this ordering exists to avoid. Measured on a client navigation: chart
  mounts at 414ms, conceal 462–641, reveal 655 and fully drawn at 1108 — and the
  y-axis labels appear on the phase switch, so the scale retargets while the
  plot is empty, where bklit puts its domain tween. The conceal ends on `inset(0 0 0 100%)` and the reveal starts on
  `inset(0 100% 0 0)`; both are an empty plot, which is what makes the handoff
  seamless.
  The phase is adjusted during render, not in an effect — an effect commits the
  stale phase first, so the chart paints one frame claiming to be loading after
  the data arrived. The lint rule against synchronous `setState` in an effect
  body is pointing at the same frame.

- **Three durations, and they are coupled.** Conceal 180ms, reveal 450ms, label
  exit 150ms. `CONCEAL_MS` in `compare-trend-chart.tsx` mirrors the
  `.chart-conceal` animation, because it is what holds the phase — let them
  drift and the plot sits empty waiting on a timer that has not fired. The label
  has to stay under the conceal or it is still animating when it unmounts.
  Why these numbers: the reveal was 1100, then 650 for consistency with the
  install chart's ~442ms entrance, then 450 for proportion. Measured on a client
  navigation, the data lands ~47ms after the chart mounts and the arrival
  animation then ran for another 890ms, so nearly everything being watched was
  choreography rather than loading; 180 + 450 brings that to ~630ms and the
  chart is fully drawn at ~1108ms rather than ~1350ms. 450 sits near the install
  chart's 442 across roughly twice the width, which an earlier note here argued
  would read as a flicker. Checked on the wide card at 45% through: the line is
  drawn to ~26% with a clean leading edge, so it still reads as a draw. That is
  the axis to watch if it is ever trimmed again.

- **The loading label is HTML over the chart, and it leaves before the plot
  does.** bklit's is the reference — its label "drifts down 30px, blurs, and
  fades" on the way out — but the gesture already exists here: `Crossfade` moves
  every swap in this app on `opacity, filter, translate` over 240ms of
  `cubic-bezier(0.32,0.72,0,1)`, so the label borrows the gesture rather than
  bklit's numbers. 150ms against the conceal's 180 so it is gone before the plot
  clears instead of racing the unmount — the label has to stay the shorter of
  the two, so they move together.
  It shimmers, through cubby-ui's `shimmer` utility — the house affordance for a
  live status. Two traps in wiring it. The highlight has to be pinned
  (`shimmer-color-foreground`): left to derive, it resolves to `currentColor` at
  20% alpha, which in light mode fades `muted-foreground` well under the 4.5:1
  it is tuned to sit at. Pinned to the foreground it darkens in light and
  brightens in dark, so contrast rises in both. And the plate cannot share the
  shimmering element — `background-clip: text` clips EVERY background on its
  element to the glyphs, so the plate would be clipped to the letters and
  vanish. Two spans. The utility handles reduced motion itself (solid text, no
  gradient, verified).
  Two things it is not. Not spinnered: the house loader is `DotMatrixRipple` and
  this chart dropped it on purpose, so a second indicator would say the same
  thing twice. Not announced: `aria-hidden`, because `aria-busy` and the chart's
  `ariaLabel` already carry it.
  The plate is on the elevation ladder, one tier above the section's `--card`
  (which is `surface-3`), because the plot's centre is exactly where a grid rule
  and the placeholder curves cross and the text was struck through without it.
  `solidSurface(4)`, not `elevatedSurface(4)`: it paints the rim into the same
  `box-shadow` rather than an `::after`, and a label with nothing but text at
  its edges does not need that overlay or the `relative` and z-index it drags
  in. Never a hand-rolled border — DESIGN.md rules that out, and the ladder is
  what keeps light and dark coherent. Here that difference is the whole point:
  `surface-3` and `surface-4` are both pure white in light, so the separation is
  the shadow alone, while in dark they are a real lightness step (0.264 to
  0.293). It ends up speaking the same language as the date pill, which carries
  its own shadow because it too sits on the plot.
  Two mechanics that are easy to get wrong. It centres on `CHART_MARGIN`, not on
  the box — the margins are asymmetric, so box-centring lands 16px off the plot
  on both axes (measured 0px off after). And it renders AFTER the overlay,
  because DOM order is what puts it on top: both are positioned, so the later
  one paints over. Placed first it sat under the SVG and the gridline and both
  curves ran straight through the words on every viewport. It carries a `bg-card`
  plate for the same reason — the plot's centre is exactly where a rule and the
  placeholder curves cross. Same colour as the section, no border, no shadow, so
  it reads as the lines breaking around the label rather than a chip on top.

- **The sweep is a `mask-image` that REVEALS the line, not a wash over one.**
  Outside the band nothing is drawn — the band IS the placeholder line. Both
  references do this and it took two readings to get right: bklit's `Line`
  exposes only `loadingStroke` and `loadingStrokeOpacity`, both documented as
  the PULSE's colour and opacity, with no prop for a line beneath it, because
  there is none; evilcharts is blunter, a clip window that "reveals the
  skeleton", re-rolling its random data while the window is off-screen
  precisely because nothing shows there. Its prose ("a soft diagonal shimmer
  sweeps across the whole line") reads like a wash and is what sent the first
  attempt wrong. The grid is untouched by any of it and stays put, which is
  bklit's arrangement too.

  Four things in that mask are load-bearing, and each was wrong once:

  - It is a mask and not a second `clip-path`, because the reveal owns that
    property on the same node.
  - DIRECTION. For a mask wider than its box, percentage positioning resolves
    to `offset = (boxW - maskW) * P/100`, i.e. `-boxW * P/100` at 200%. Positive
    P moves the mask LEFT, so the band runs right-to-left. Counting down to
    `-200%` is what makes it read left-to-right.
  - SEAMLESS. `repeat`, not `no-repeat`, travelling exactly one tile, so the
    restart frame equals the frame it ended on. Both gradient ends sit in the
    same flat 0, so the tile seam falls in a constant region.
  - NO GAP. Two bands per tile, at 25% and 75%, putting them one box-width
    apart so exactly one is always crossing. One band per tile leaves the marks
    bare for half of every cycle, which reads as the sweep cutting out.

  `linear`, necessarily: an eased loop is eased per CYCLE, and a cycle is two
  crossings, so it would slow every other one. The band's character comes from
  the gradient's falloff (stops ramping through 0.5) rather than from timing.
  2400ms per cycle is 1200ms per crossing, matched by the label's
  `shimmer-duration-1200` so the two keep one tempo. Verified running on the
  `<g>` — CSS masks apply to SVG groups.

- **Placeholder shapes are fine; placeholder labels are not — on either axis.**
  A drawn line reads as "something will be here"; an axis label reads as a
  measurement. Both axes therefore keep their grid rules and drop their
  `tickLabels` while loading. The x axis was the easy one to get wrong: its
  dates are real dates, which sounds like enough, but the placeholder spans the
  last three weeks ending today while the real series ends wherever its
  snapshots do — so the axis announced Aug 7–27 and then jumped back to
  Jul 31–Aug 21 on the reveal. A range is a claim about the data exactly as a
  count is. Kill both tooltip paths as well — `tooltip: false` for the pointer
  and `keyboard: false`, because arrow keys still move focus on a chart whose
  `pointer` is already false — and pass `disabled` to `ChartHoverOverlay`, which
  is the one cursor the definition cannot switch off.

- **Pin the y axis's margin, or the plot's left edge becomes a function of the
  data.** The scene solver sizes that side to the widest label it is currently
  drawing. Unlabelled placeholder to labelled real series measured a 16px
  narrowing of the plot, and the grid rules sit outside `ts-chart__marks`, so
  neither the conceal nor the reveal covers it — the gridlines simply jump. The
  same solve runs on any data change, so comparing a skill an order of magnitude
  bigger moves the edge too. `Y_AXIS_LABEL_MARGIN` pins it; measured 0px of
  shift across the transition afterwards. The trade is that a label wider than
  the gutter clips instead of pushing the plot, which is why that constant
  carries its measurement.

- **A chart can mount into a box that is not laid out yet, and the fallback for
  that is a constant.** `currentWidth()` treats a zero measurement as "cannot
  measure" and uses `initialWidth`, which is right at one viewport size. Mounting
  the compare chart early enough to be the loading state put it inside the
  Suspense reveal, where the container is 0 for one frame: the scene was built at
  `INITIAL_WIDTH.compare` and painted 4% oversized in a 1207px box for ~130ms
  before the ResizeObserver corrected it — cold and warm alike. `useMeasuredHost`
  holds the render for that one commit while a CSS box reserves the height. Note
  this is the same failure as the dialog's scaling ancestor arriving by a
  different road: there the measurement was wrong and never corrected, here it is
  wrong and corrects late.

- **Loading is not "no data".** `CompareTrendChart` early-returns
  `CompareTrendGhost` when no series has enough history, which is a resolved
  answer; the loading branch has to be ordered around it or "not answered yet"
  gets reported as "nothing to show".

- **`keepPreviousData` will hand over an answer to a different question, and
  `isPending` is false while it does.** That is the point of it when the two
  comparisons overlap — adding a skill keeps the chart mounted and lets the new
  line animate in. It is a bug when they do not overlap: compare two skills, go
  home, then compare a third from the skill sheet, and the placeholder rows are
  the previous pair's. None of the new refs resolve, so every series arrives
  empty, `isPending` is false, and the chart skips its loading state entirely
  and renders the ghost — reporting "not enough history yet" about data it has
  never seen. Reproduced and fixed: `insightsCoverRefs` in `compare-content.tsx`
  asks whether any current ref resolves in the insights being held, and the
  chart is loading when none does. Cheap to miss because it needs a prior
  compare in the same session; a cold load or a first navigation never shows it.

- **The page's own fallback is a third layer and deliberately generic.**
  `CompareFallback` in `app/(main)/compare/page.tsx` is the prerendered static
  shell — `?skills=` is unknown at build time, so `CompareContent` sits behind
  Suspense. It cannot take the chart's silhouette because it also covers the
  empty state, where there is no chart. It is not a duplicate of the chart's
  loading state; it is the shell that precedes it.

## DOM coupling

`components/charts/chart-hover-overlay.tsx` is the only place that reaches into
the chart's rendered DOM (for the line's `d`, and to fade the axis labels the
date pill covers). That is real coupling to the library's output; it is
deliberate, because rebuilding the curve would not trace it exactly.
