/**
 * Static dot-grid backdrop with a single accent dot — the brand motif used
 * behind empty-state panels. Pure SVG, server-safe.
 */
export function DotMatrix({
  cols = 24,
  rows = 10,
  spacing = 16,
  accentCol = 17,
  accentRow = 2,
}: {
  cols?: number;
  rows?: number;
  spacing?: number;
  accentCol?: number;
  accentRow?: number;
}) {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      width="100%"
      height="100%"
      preserveAspectRatio="xMaxYMin slice"
    >
      <g transform="translate(12, 12)">
        {Array.from({ length: rows }).map((_, r) =>
          Array.from({ length: cols }).map((_, c) => {
            const isAccent = r === accentRow && c === accentCol;
            return (
              <circle
                key={`${r}-${c}`}
                cx={c * spacing}
                cy={r * spacing}
                r={isAccent ? 2.25 : 1}
                className={isAccent ? "fill-primary" : "fill-foreground/10"}
              />
            );
          }),
        )}
      </g>
    </svg>
  );
}
