"use client";

import { Check, Minus } from "lucide-react";
import { COMPARISON, type ComparisonValue } from "@/lib/plans";
import { cn } from "@/lib/utils";

export function PricingComparison() {
  return (
    <div aria-labelledby="compare-heading" className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-widest uppercase">
          <span
            aria-hidden
            className="bg-primary inline-block size-1.5 rounded-full"
          />
          <span>Compare plans</span>
        </div>
        <h2
          id="compare-heading"
          className="font-display text-3xl font-medium tracking-tight md:text-4xl"
        >
          Every feature, side by side.
        </h2>
      </div>

      <div className="bg-card overflow-hidden rounded-2xl border">
        <div className="grid grid-cols-[1.5fr_1fr_1fr] items-center gap-4 px-6 py-5 text-sm">
          <div className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
            Feature
          </div>
          <div className="text-center text-xs font-medium tracking-wider uppercase">
            Free
          </div>
          <div className="text-primary text-center text-xs font-medium tracking-wider uppercase">
            Pro
          </div>
        </div>

        {COMPARISON.map((group, gi) => (
          <div
            key={group.title}
            className={cn(
              "border-border/60 border-t",
              gi === 0 && "border-t-0 border-t",
            )}
          >
            <div className="bg-muted/40 px-6 py-2.5">
              <span className="font-display text-sm font-medium tracking-tight">
                {group.title}
              </span>
            </div>
            <ul>
              {group.rows.map((row, ri) => (
                <li
                  key={row.label}
                  className={cn(
                    "grid grid-cols-[1.5fr_1fr_1fr] items-center gap-4 px-6 py-4 text-sm",
                    ri !== group.rows.length - 1 && "border-border/60 border-b",
                  )}
                >
                  <span className="text-foreground/90">{row.label}</span>
                  <ValueCell value={row.free} />
                  <ValueCell value={row.pro} accent />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function ValueCell({
  value,
  accent = false,
}: {
  value: ComparisonValue;
  accent?: boolean;
}) {
  if (value === true) {
    return (
      <div className="flex justify-center">
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-full",
            accent ? "bg-primary/10 text-primary" : "bg-muted text-foreground",
          )}
          aria-label="Included"
        >
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      </div>
    );
  }

  if (value === false) {
    return (
      <div className="flex justify-center">
        <span
          className="text-muted-foreground/50 flex size-6 items-center justify-center"
          aria-label="Not included"
        >
          <Minus className="size-4" />
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "text-center text-sm",
        accent ? "text-foreground font-medium" : "text-muted-foreground",
      )}
    >
      {value}
    </div>
  );
}
