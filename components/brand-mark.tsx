import { cn } from "@/lib/utils";

interface BrandMarkProps {
  className?: string;
}

export function BrandMark({ className }: BrandMarkProps) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg
        aria-hidden="true"
        viewBox="0 0 120 108"
        className="size-6 shrink-0"
        fill="currentColor"
      >
        <path d="m17.2,39.3c3.3,-3.3 7.1,-6.5 13.6,-6.5l18.8,0l6.7,-23.4c-0.7,-3.3 -3.8,-5.8 -7.2,-4.9l-33.3,8.9c-2.8,0.8 -5.2,4.4 -4.2,7.6l5.6,18.3z" />
        <path d="m107.9,27.2l-0.5,-0.3l-1.4,5.9l2.5,0c0.9,0 2,0.1 3.2,0.2c-0.2,-1.6 -1,-4.1 -3.8,-5.8z" />
        <path d="m53.2,32.8l49.3,0l4.1,-13.4c0.8,-2.8 -1.1,-6.5 -3.8,-7.3l-34.2,-10.2c-3.5,-1 -6.8,1 -7.8,4.2l-6,20.8l-1.6,5.9z" />
        <path d="m9.3,25.2c-4.1,0.4 -7.9,4.9 -7.5,9.8l4.1,53.8l7.4,-41.4c0.3,-1.5 0.8,-3.1 1.3,-4.1l-5.3,-18.1z" />
        <path d="m110.5,36.6l-80.6,0c-6,0 -12.3,5.2 -13.2,11.4l-9,49.2c-0.5,4.6 2.8,8.9 7.5,8.9l82.6,0c6.1,0 11,-4.3 11.9,-9.8l8.7,-49.2c1.1,-5.5 -3.2,-10.2 -7.9,-10.5z" />
      </svg>
      <span className="font-display text-lg font-bold tracking-tight">
        skillbundle
      </span>
    </span>
  );
}
