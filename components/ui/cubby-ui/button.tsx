"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Button as BaseButton } from "@base-ui/react/button";
// The app's one busy visual, shared with the search inputs and the compare
// chart. A LOCAL divergence: upstream ships a spinning HugeIcon here, because a
// registry component cannot depend on something outside the registry. Restoring
// it also keeps @hugeicons/core-free-icons — a 6.3 MB non-barrel module — out of
// the graph of every route, which importing it here would put it in.
// Re-apply after any `shadcn add`; see TODO.md "Local cubby-ui divergences".
import { DotMatrixRipple } from "@/components/ui/dot-matrix-ripple";
import { cn } from "@/lib/utils";

// The button's fill and border render on a ::before pseudo-element that
// scales down on press (the pill shrinks, the label stays put). Because the
// pseudo travels with the classes, every consumer of the recipe — <Button>
// and flat elements styled via `buttonVariants` (pagination links, calendar
// nav, toolbar buttons) — gets identical paint and press behavior with no
// extra DOM. ButtonGroup collapses borders between segments with `before:`
// rules, inert on children that don't carry the recipe.
//
// Paint: variants set per-state tokens (--btn-bg, --btn-bg-hover,
// --btn-bg-active, --btn-border), the state machine below resolves them into
// --btn-paint, and buttonPaint renders it on the pseudo (custom properties
// inherit into pseudo-elements). Consumers recolor by overriding the tokens
// (className="[--btn-bg:...]") and restyle the border via `before:` classes
// (className="before:border-dashed").
const buttonBase = cn(
  "relative isolate inline-flex items-center cursor-pointer justify-center whitespace-nowrap rounded-lg font-medium data-disabled:pointer-events-none data-disabled:opacity-60 data-disabled:focus-visible:outline-ring [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 focus-visible:outline-ring/50 outline-0 outline-offset-0 outline-transparent transition-[outline-width,outline-offset,outline-color,scale,opacity,background-color,color] duration-100 ease-out outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 aria-invalid:outline-destructive/50 aria-invalid:outline-2 aria-invalid:outline-offset-2 aria-invalid:outline-solid",
  // State machine: unset tokens fall through to transparent. Pressing shows
  // the active paint — except on popup triggers (aria-haspopup), which skip
  // pressed feedback entirely (mirroring the press-scale guard) and simply
  // hold their hover paint while open (data-popup-open, stamped by Base UI).
  "[--btn-paint:var(--btn-bg,transparent)] hover:[--btn-paint:var(--btn-bg-hover,var(--btn-bg,transparent))] active:not-aria-[haspopup]:[--btn-paint:var(--btn-bg-active,var(--btn-bg-hover,var(--btn-bg,transparent)))] data-popup-open:[--btn-paint:var(--btn-bg-hover,var(--btn-bg,transparent))]",
);

// The paint pseudo-element: 1px border + fill from the resolved vars,
// transparent when unset. -z-10 keeps it under the content (the root's
// `isolate` contains it), and pressing scales only the pseudo — except on
// popup triggers (aria-haspopup), which skip press feedback and hold their
// hover paint while open instead.
const buttonPaint =
  "before:content-[''] before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:border before:border-[color:var(--btn-border,transparent)] before:bg-[var(--btn-paint,transparent)] before:transition-[background-color,border-color,scale] before:duration-100 before:ease-out active:not-aria-[haspopup]:before:scale-[0.98]";

// Text classes plus the paint tokens the state machine reads.
const buttonVariantClasses = {
  primary:
    "text-primary-foreground [--btn-bg:var(--primary)] [--btn-bg-hover:var(--primary-hover)] [--btn-bg-active:var(--primary-active)]",
  "primary-soft":
    "text-(--primary-soft-foreground) [--btn-bg:var(--secondary)] [--btn-bg-hover:var(--secondary-hover)] [--btn-bg-active:var(--secondary-active)]",
  neutral:
    "text-neutral-foreground [--btn-bg:var(--neutral)] [--btn-bg-hover:var(--neutral-hover)] [--btn-bg-active:var(--neutral-active)]",
  destructive:
    "text-destructive-foreground [--btn-border:rgb(0_0_0/0.05)] dark:[--btn-border:rgb(255_255_255/0.05)] [--btn-bg:var(--destructive)] [--btn-bg-hover:var(--destructive-hover)] [--btn-bg-active:var(--destructive-active)]",
  "destructive-soft":
    "text-(--destructive-soft-foreground) [--btn-bg:color-mix(in_oklab,var(--destructive)_12%,transparent)] [--btn-bg-hover:color-mix(in_oklab,var(--destructive)_20%,transparent)] [--btn-bg-active:color-mix(in_oklab,var(--destructive)_25%,transparent)]",
  // bg-clip-padding keeps the card fill out from under the translucent
  // border. Deliberately NOT in the shared paint: with the default
  // transparent border it would inset every solid fill by 1px.
  outline:
    "[--btn-border:var(--border)] [--btn-bg:var(--card)] [--btn-bg-hover:var(--outline-hover)] [--btn-bg-active:var(--outline-active)] before:bg-clip-padding",
  // Outline's border with ghost's transparent fill, for elevated substrates
  // (Cards, Dialogs) where outline's solid card fill would look mismatched.
  "outline-ghost":
    "[--btn-border:var(--border)] [--btn-bg-hover:var(--surface-hover)] [--btn-bg-active:var(--surface-active)]",
  secondary:
    "text-secondary-foreground [--btn-bg:var(--secondary)] [--btn-bg-hover:var(--secondary-hover)] [--btn-bg-active:var(--secondary-active)]",
  ghost:
    "text-muted-foreground hover:text-foreground data-popup-open:text-foreground [--btn-bg-hover:var(--surface-hover)] [--btn-bg-active:var(--surface-active)]",
  link: "text-primary underline-offset-4 hover:underline",
};

// Heights match the Input/Select ramp (36px desktop default) so buttons pair
// with form fields. Below the sm breakpoint each size is one step taller for
// touch targets.
const buttonSizeVariantClasses = {
  default: "h-10 sm:h-9 px-3.5 gap-1.5 text-sm",
  xs: "h-8 sm:h-7 px-2.5 gap-1 text-xs rounded-md [&_svg:not([class*='size-'])]:size-3.5",
  sm: "h-9 sm:h-8 px-3 gap-1.5 text-sm",
  lg: "h-11 sm:h-10 px-3.5 gap-1.5 text-base [&_svg:not([class*='size-'])]:size-5",
  icon: "size-10 sm:size-9 text-sm",
  icon_xs:
    "size-8 sm:size-7 rounded-md text-xs [&_svg:not([class*='size-'])]:size-3.5",
  icon_sm: "size-9 sm:size-8 text-sm",
  icon_lg: "size-11 sm:size-10 text-base [&_svg:not([class*='size-'])]:size-5",
};

// Sizes with no text slot. For these, children render bare (no text-box
// wrapper) and leadingIcon/trailingIcon are ignored — a fixed square has no
// room for an icon beside a label.
const iconOnlySizes = new Set<keyof typeof buttonSizeVariantClasses>([
  "icon",
  "icon_xs",
  "icon_sm",
  "icon_lg",
]);

// Fills the root and mirrors its justification so root-level overrides like
// justify-between keep working.
const buttonContentLayout =
  "inline-flex w-full items-center [justify-content:inherit] gap-[inherit]";

// The one button recipe, used by <Button> and by flat elements (links,
// calendar nav, toolbar buttons) alike — paint, states, and press behavior
// are identical in both. iconLeft/iconRight tighten padding on the icon side
// (an icon is visually lighter than a text edge); <Button> sets them from
// its icon props, flat consumers can pass them explicitly.
const buttonVariants = cva(cn(buttonBase, buttonPaint), {
  variants: {
    variant: buttonVariantClasses,
    size: buttonSizeVariantClasses,
    iconLeft: { true: "" },
    iconRight: { true: "" },
  },
  compoundVariants: [
    { size: "default", iconLeft: true, className: "pl-2.5" },
    { size: "default", iconRight: true, className: "pr-2.5" },
    { size: "sm", iconLeft: true, className: "pl-2" },
    { size: "sm", iconRight: true, className: "pr-2" },
    { size: "xs", iconLeft: true, className: "pl-2" },
    { size: "xs", iconRight: true, className: "pr-2" },
    { size: "lg", iconLeft: true, className: "pl-2.5" },
    { size: "lg", iconRight: true, className: "pr-2.5" },
  ],
  defaultVariants: {
    variant: "primary",
    size: "default",
  },
});

export type ButtonProps = BaseButton.Props &
  Omit<VariantProps<typeof buttonVariants>, "iconLeft" | "iconRight"> & {
    loading?: boolean;
    leadingIcon?: React.ReactNode;
    trailingIcon?: React.ReactNode;
  };

function Button({
  className,
  variant,
  size,
  loading,
  children,
  disabled,
  focusableWhenDisabled,
  leadingIcon,
  trailingIcon,
  ...props
}: ButtonProps) {
  const isIconOnly = size != null && iconOnlySizes.has(size);

  // `loading` takes an icon slot and leaves the LABEL VISIBLE: it replaces the
  // leading icon, or sits on the right when there is a trailing icon (or no
  // leading one). Restored after a registry refresh replaced it with a centred
  // spinner over `opacity-0` content — which silently blanked the five call
  // sites that swap in a pending label ("Saving…", "Creating…", "Opening…").
  // Wrapped in aria-hidden because DotMatrixRipple renders its own
  // role="status" aria-live, and a live region inside a <button> is pruned as
  // presentational; `aria-busy` below is the signal.
  const loader = loading ? (
    <span aria-hidden className="inline-flex shrink-0">
      <DotMatrixRipple size="xs" />
    </span>
  ) : null;
  const loaderOnRight = !!loader && (trailingIcon != null || leadingIcon == null);
  const resolvedLeading = loader && !loaderOnRight ? loader : leadingIcon;
  const resolvedTrailing = loaderOnRight ? loader : trailingIcon;

  // A fixed square has no room for a label beside the loader, so there the
  // loader stands in for the children rather than joining them.
  const content = isIconOnly ? (
    (loader ?? children)
  ) : (
    <>
      {resolvedLeading}
      {/* text-box trims ascent/descent whitespace for optical centering;
          unsupported browsers fall back to metrics centering. */}
      <span className="[text-box:trim-both_cap_alphabetic]">{children}</span>
      {resolvedTrailing}
    </>
  );

  return (
    <BaseButton
      data-slot="button"
      data-size={size}
      data-variant={variant}
      className={cn(
        buttonVariants({
          variant,
          size,
          // Resolved, not raw: while loading the loader occupies a slot, and
          // the optical padding has to follow it.
          iconLeft: !!resolvedLeading,
          iconRight: !!resolvedTrailing,
        }),
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
      focusableWhenDisabled={focusableWhenDisabled ?? loading}
    >
      <span
        data-slot="button-content"
        className={cn("relative", buttonContentLayout)}
      >
        {/* No sr-only live region anywhere in here, deliberately. `sr-only`
            clips rather than hides, so its text would join name-from-content
            and the button would rename itself mid-request ("Save bundle" ->
            "Saving… Loading"). It would not announce anyway: role button makes
            its descendants presentational, and a region that mounts already
            holding its text has not changed. `aria-busy` above is the signal
            that works, and callers that want words swap their own label (see
            components/auth/shared.tsx). */}
        {content}
      </span>
    </BaseButton>
  );
}

export { Button, buttonVariants };
