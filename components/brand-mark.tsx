import { cn } from "@/lib/utils";

/**
 * The SkillBundle logo mark (icon only). Native aspect ratio is 69.7 × 44, so
 * size it by height and let the width follow (`h-5 w-auto`). Inherits color via
 * `currentColor`.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 69.7 44"
      className={cn("h-5 w-auto shrink-0", className)}
      fill="currentColor"
    >
      <path d="m24.5 36-2.7-2.7c-2.8-3.3-3-8.4 0.6-11.5l9.2-9.2c0.9-1 2.2-1.6 3.5-1.6 1.6 0 2.9 0.6 3.9 1.7l0.4 0.4c1.9 2.1 1.9 5.2-0.1 7.2l-5.7 5.8c-1.3 1.1-1.2 3-0.1 4.2s3 2.2 4.7 0.9l8.1-7.8c1.1-1 2.1-3.1 2-5.1 0.1-1.6-0.6-3.4-1.7-4.7-0.6-0.7-9.5-10.1-9.8-10.3-1.8-1.7-4.1-3.1-7.2-3.1-2.7 0-5.2 1-7.4 3l-18.3 18.2c-2 2.1-3.1 4.7-3 7.5 0.1 2.5 1.2 4.9 2.8 6.6l4.5 4.7c1.6 1.7 4 3.3 7 3.3h0.1c2.3 0 4.5-0.8 6.2-2.2l3-3c0.6-0.5 0.6-1.7 0-2.3z" />
      <path d="m66.4 8.1-5.1-5.1c-1.7-1.7-4-2.9-7-2.8-2.4 0-4.7 0.9-6.6 2.6l-3 3c-0.7 0.7-0.6 1.7 0 2.3l3.8 3.8c1.6 1.7 2.4 4 2.4 6.1 0 2.5-0.9 4.8-2.7 7l-8.2 8c-1 0.9-2.2 1.5-3.7 1.5s-2.8-0.6-3.9-1.6c-1.1-1.1-1.9-2.6-2.1-4.2v-0.8c0.2-1.2 0.7-2.3 1.5-3.1l5.5-5.9c1.1-1 1.1-2.8 0-3.9-1.1-1.4-3.1-1.7-4.2-0.5l-8.9 9.1c-2 2-2.5 5.5-0.2 8.5l8.9 8.8c2 1.8 4.4 3 7.1 3 2.6 0 5-0.6 7.3-2.7l18.6-18.5c1.8-2.1 3-4.6 3-7.6 0-2.7-1-5.1-2.5-7z" />
    </svg>
  );
}

/** The full brand signature: logo mark + lowercase wordmark. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="font-display text-lg font-medium tracking-tight">
        skillbundle
      </span>
    </span>
  );
}
