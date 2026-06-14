import "server-only";
import type { ReactElement, ReactNode } from "react";
import { ImageResponse } from "next/og";
import { OG_SIZE } from "./theme";
import { og } from "./theme";
import { FONT, loadOgFonts } from "./fonts";

/**
 * Building blocks for the generated OG images. Satori (the engine behind
 * `next/og`) supports only flexbox and a subset of CSS, so every multi-child
 * element carries an explicit `display: flex`, all colors are literal sRGB
 * (see `theme.ts`), and long strings are truncated in JS.
 *
 * Design system:
 *   - Geist Pixel (the brand's display face) is used BIG — section words, the
 *     wordmark, and every figure — because below ~40px its circular pixels
 *     merge into a plain mono and the identity disappears. It is never used for
 *     body copy or variable-length names.
 *   - Geist Sans carries names, descriptions, and labels (legible at any size).
 *   - Monochrome on near-black with blue as a single, rare accent. No glow, no
 *     background texture, no eyebrow pills — structure comes from a hairline
 *     header rule and precise alignment.
 */

const PADDING = 72;

/** The real SkillBundle logo (from components/brand-mark.tsx). */
const LOGO_PATHS = [
  "m17.2,39.3c3.3,-3.3 7.1,-6.5 13.6,-6.5l18.8,0l6.7,-23.4c-0.7,-3.3 -3.8,-5.8 -7.2,-4.9l-33.3,8.9c-2.8,0.8 -5.2,4.4 -4.2,7.6l5.6,18.3z",
  "m107.9,27.2l-0.5,-0.3l-1.4,5.9l2.5,0c0.9,0 2,0.1 3.2,0.2c-0.2,-1.6 -1,-4.1 -3.8,-5.8z",
  "m53.2,32.8l49.3,0l4.1,-13.4c0.8,-2.8 -1.1,-6.5 -3.8,-7.3l-34.2,-10.2c-3.5,-1 -6.8,1 -7.8,4.2l-6,20.8l-1.6,5.9z",
  "m9.3,25.2c-4.1,0.4 -7.9,4.9 -7.5,9.8l4.1,53.8l7.4,-41.4c0.3,-1.5 0.8,-3.1 1.3,-4.1l-5.3,-18.1z",
  "m110.5,36.6l-80.6,0c-6,0 -12.3,5.2 -13.2,11.4l-9,49.2c-0.5,4.6 2.8,8.9 7.5,8.9l82.6,0c6.1,0 11,-4.3 11.9,-9.8l8.7,-49.2c1.1,-5.5 -3.2,-10.2 -7.9,-10.5z",
] as const;

function Logo({ size = 34, color = og.fg }: { size?: number; color?: string }) {
  // viewBox 120x108 → keep aspect ratio.
  return (
    <svg
      width={size}
      height={(size * 108) / 120}
      viewBox="0 0 120 108"
      fill={color}
    >
      {LOGO_PATHS.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

/** A large, faint brand mark bleeding off the right edge — fills the dark
 *  negative space with depth and brand presence. Very low opacity so it reads
 *  as texture, not decoration; painted before content so text stays crisp. */
export function Watermark() {
  return (
    <div
      style={{
        position: "absolute",
        top: 150,
        right: -132,
        display: "flex",
        opacity: 0.05,
      }}
    >
      <Logo size={430} color={og.fg} />
    </div>
  );
}

/** Brand signature: the real logo + the lowercase pixel wordmark. */
function BrandLockup() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
      <Logo size={32} />
      <div
        style={{
          display: "flex",
          fontFamily: FONT.pixel,
          fontSize: 30,
          color: og.fg,
          letterSpacing: "0.01em",
        }}
      >
        skillbundle
      </div>
    </div>
  );
}

/** The brand presented large: logo + the pixel wordmark at hero scale. Used on
 *  the home/default card where the wordmark itself is the subject. */
export function BrandHero() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
      <Logo size={66} />
      <div
        style={{
          display: "flex",
          fontFamily: FONT.pixel,
          fontSize: 70,
          color: og.fg,
          letterSpacing: "0.01em",
        }}
      >
        skillbundle
      </div>
    </div>
  );
}

/** Build the final PNG with the brand fonts attached. */
export async function renderOg(node: ReactElement): Promise<ImageResponse> {
  const fonts = await loadOgFonts();
  return new ImageResponse(node, {
    ...OG_SIZE,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ttf Buffer is a valid font source at runtime; the typed signature expects ArrayBuffer
    fonts: fonts as any,
  });
}

/**
 * The shared frame: near-black surface, a header row (brand lockup + a quiet
 * category label) divided from the body by a single hairline, then the content.
 * No glow, no texture — structure carries it.
 */
export function Frame({
  category,
  children,
}: {
  /** Quiet label shown top-right. Omit on cards whose hero already names the
   *  surface (e.g. the big pixel section word). */
  category?: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: og.bg,
        color: og.fg,
        fontFamily: FONT.sans,
        padding: PADDING,
      }}
    >
      <Watermark />

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingBottom: 26,
          borderBottom: `1px solid ${og.border}`,
        }}
      >
        <BrandLockup />
        {category ? (
          <div
            style={{
              display: "flex",
              fontSize: 20,
              fontWeight: 500,
              color: og.dim,
            }}
          >
            {category}
          </div>
        ) : null}
      </div>

      {/* Body */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "center",
          paddingTop: 8,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** A large dot-matrix word — the pixel font as hero (section names, wordmark).
 *  Use only for short, fixed strings; it's unreadable for long/variable text. */
export function PixelHero({ text, size = 104 }: { text: string; size?: number }) {
  return (
    <div
      style={{
        display: "flex",
        fontFamily: FONT.pixel,
        fontSize: size,
        lineHeight: 1,
        color: og.fg,
      }}
    >
      {text}
    </div>
  );
}

/** A single-line entity name in Geist (used where text is variable-length). */
export function Title({ text, size = 60 }: { text: string; size?: number }) {
  return (
    <div
      style={{
        display: "flex",
        fontSize: size,
        fontWeight: 700,
        letterSpacing: "-0.03em",
        lineHeight: 1.25,
        color: og.fg,
        maxWidth: "100%",
        overflow: "hidden",
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
      }}
    >
      {text}
    </div>
  );
}

/** Wrapping marketing headline (section/home cards). */
export function DisplayTitle({ text }: { text: string }) {
  const size = text.length <= 24 ? 80 : text.length <= 42 ? 66 : 56;
  return (
    <div
      style={{
        display: "flex",
        fontSize: size,
        fontWeight: 700,
        letterSpacing: "-0.03em",
        lineHeight: 1.05,
        color: og.fg,
        maxWidth: 1000,
      }}
    >
      {text}
    </div>
  );
}

export function Lede({ text, top = 20 }: { text: string; top?: number }) {
  return (
    <div
      style={{
        display: "flex",
        marginTop: top,
        fontSize: 27,
        lineHeight: 1.35,
        color: og.muted,
        maxWidth: 940,
      }}
    >
      {text}
    </div>
  );
}

/** Source / metadata line, blue accent. */
export function MetaLine({ text }: { text: string }) {
  return (
    <div
      style={{
        display: "flex",
        marginTop: 16,
        fontSize: 24,
        fontWeight: 500,
        color: og.primaryBright,
      }}
    >
      {text}
    </div>
  );
}

/**
 * Overview figures with the numbers rendered in the dot-matrix pixel face —
 * the brand's signature for any card that summarizes a collection. Figures are
 * always short, so pixel stays legible and distinctive.
 */
export function PixelStatStrip({
  stats,
  top = 48,
}: {
  stats: { value: string; label: string }[];
  top?: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", marginTop: top }}>
      {stats.map((s, i) => (
        <div
          key={s.label}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            paddingLeft: i === 0 ? 0 : 44,
            paddingRight: 44,
            borderLeft: i === 0 ? "none" : `1px solid ${og.border}`,
          }}
        >
          <div
            style={{
              display: "flex",
              fontFamily: FONT.pixel,
              fontSize: 58,
              lineHeight: 1,
              color: og.fg,
            }}
          >
            {s.value}
          </div>
          <div style={{ display: "flex", fontSize: 21, color: og.muted }}>
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A terminal-style install command in Geist Mono. The command is truncated in
 *  JS so it never overflows (Satori won't reliably ellipsize a flex child). */
export function CommandRow({ command }: { command: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "16px 22px",
        borderRadius: 12,
        border: `1px solid ${og.border}`,
        background: og.surface,
        fontFamily: FONT.mono,
        fontSize: 22,
        color: og.fg,
        whiteSpace: "nowrap",
      }}
    >
      <div style={{ display: "flex", color: og.primaryBright }}>$</div>
      <div style={{ display: "flex" }}>{truncate(command, 60)}</div>
    </div>
  );
}

/** A quiet inline tag (Official, audit verdict) — text + a leading marker, no
 *  pill chrome. `tone` colors both. */
export function Tag({
  label,
  tone = "default",
}: {
  label: string;
  tone?: "default" | "accent" | "warning" | "danger";
}) {
  const color =
    tone === "accent"
      ? og.primaryBright
      : tone === "warning"
        ? og.warning
        : tone === "danger"
          ? og.danger
          : og.muted;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <div
        style={{ display: "flex", width: 7, height: 7, background: color }}
      />
      <div style={{ display: "flex", fontSize: 21, color }}>{label}</div>
    </div>
  );
}

/** Truncate to a hard character budget so single-line text never overflows. */
export function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}
