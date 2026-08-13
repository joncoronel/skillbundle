import { HeaderPill } from "@/components/header-pill";

/**
 * The app header: a floating pill over a scrim.
 *
 * ── The one rule the pill runs on ─────────────────────────────────────────
 *
 * It is always the OPPOSITE of the page it floats over: near-black in light
 * mode, a lifted surface in dark. That is why it reads as an object sitting on
 * the page rather than a band attached to the top of it, and it is why the
 * treatment survives both themes — "dark bar" cannot be literal in dark mode,
 * where a near-black pill would vanish into a near-black field. The tokens that
 * carry it live in header-pill.tsx.
 *
 * ── Two consequences worth knowing before editing ─────────────────────────
 *
 * The pill is opaque and does NOT span the viewport above `sm`, so content
 * scrolls past on both sides of it. That is the point of the pattern, but it
 * means the strip ABOVE the pill would show text sliding through a 16px slit,
 * which reads as a rendering fault rather than as depth. The scrim is what
 * stops that; it is functional, not decoration, and removing it will look
 * broken at any scroll position other than the top.
 *
 * Height: the old bar ended at 56px, this one ends at 72px. Sticky offsets
 * elsewhere (the skill page's rail and record card, `scroll-mt` on anchor
 * targets) are set clear of that, so changing the pill's top padding means
 * checking them again.
 */
export function AppHeader() {
  return (
    // The height is FIXED and the pill inside is absolutely positioned, so the
    // header reserves exactly the closed pill's footprint in flow — 12px + 56px
    // on phones, 16px + 56px from `sm` — and nothing more. That is what stops
    // the expanding mobile menu from shoving the page down: a sticky element
    // still participates in layout, so while the pill was in flow, growing it
    // grew the header and pushed every page down with it. Absolute takes the
    // growth out of flow entirely; the menu now overlays the page like a menu
    // should.
    //
    // Change `pt-3` / `sm:pt-4` and this height has to change with it.
    <header className="sticky top-0 z-40 h-17 sm:h-18">
      {/* The first stop is held to 65% — roughly the pill's bottom edge at 72px
          — so the band is fully opaque for the whole height the pill occupies
          and only dissolves BELOW it. A gradient that starts fading immediately
          (the first attempt) is 46% transparent by the time it reaches the
          pill's own vertical band, which puts moving text in the gap beside the
          pill and looks like a paint bug. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-linear-to-b from-background from-65% to-transparent"
      />

      <div className="absolute inset-x-0 top-0 px-4 pt-3 sm:pt-4">
        <HeaderPill />
      </div>
    </header>
  );
}
