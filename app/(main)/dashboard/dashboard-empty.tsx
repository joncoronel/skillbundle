import Link from "next/link";
import { Button } from "@/components/ui/cubby-ui/button";

export function DashboardEmpty() {
  return (
    <div className="relative overflow-hidden rounded-xl bg-muted/40">
      <DotMatrix />
      <div className="relative px-6 py-16 md:px-12 md:py-24">
        <h2 className="font-display text-4xl font-semibold tracking-tight leading-hero text-balance md:text-5xl">
          Start with a stack.
        </h2>
        <p className="mt-4 max-w-md text-sm text-muted-foreground">
          Pick your tech, save the skills that fit, and your bundles will live
          here. Share them, install them, fork them later.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            nativeButton={false}
            render={<Link href="/" />}
          >
            Build your first bundle
          </Button>
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link href="/explore" />}
          >
            Explore public bundles
          </Button>
        </div>
      </div>
    </div>
  );
}

function DotMatrix() {
  const cols = 24;
  const rows = 10;
  const spacing = 16;
  const accentCol = 17;
  const accentRow = 2;

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
                className={
                  isAccent
                    ? "fill-primary"
                    : "fill-foreground/10"
                }
              />
            );
          }),
        )}
      </g>
    </svg>
  );
}
