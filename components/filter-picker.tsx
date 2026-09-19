"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  Search01Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";
import {
  ComboboxInput,
  ComboboxPopup,
} from "@/components/ui/cubby-ui/combobox/combobox";
import { Button } from "@/components/ui/cubby-ui/button";
import { cn } from "@/lib/utils";

/** Shared pieces of the catalog's combobox filters (Publisher, Category). */

/**
 * For ComboboxItem rows. The vendored `1fr` track can't shrink below its
 * content, so one unbreakable name made the list scroll sideways. Rows also
 * need their own flex wrapper: the item puts children in a plain block, so
 * ItemCount's `ml-auto` has nothing to push against.
 */
export const PICKER_ITEM_COLUMNS = "grid-cols-[minmax(0,1fr)_1rem]";

/** Shows `name` when empty, the selection otherwise; the accessible name
 *  always includes the selection. */
export function FilterPickerTrigger({
  triggerProps,
  name,
  selectionLabel,
  inSheet,
  className,
}: {
  triggerProps: React.ComponentProps<"button">;
  name: string;
  /** e.g. "Testing & QA", "3 categories"; null when nothing is selected. */
  selectionLabel: string | null;
  inSheet: boolean;
  className?: string;
}) {
  return (
    <Button
      {...triggerProps}
      size="sm"
      variant={inSheet ? "outline" : "ghost"}
      aria-label={
        selectionLabel === null
          ? `Filter by ${name.toLowerCase()}`
          : `${name}: ${selectionLabel}`
      }
      className={cn(
        // No active-state border — the label ("2 publishers") is the
        // indicator, matching the other filter pills (which don't tint).
        "justify-between gap-2",
        // Match the Select triggers' surface: ghost in the composer chin,
        // translucent-elevated in the mobile sheet.
        //
        // Recolour through the --btn-* tokens, never `bg-*`. The Button
        // recipe paints its fill on a ::before pseudo, so a `bg-*` here
        // lands on the root instead and the two layers composite — a
        // second `hover:bg-surface-hover` read as double-strength hover.
        // tailwind-merge can't catch it either: it has no way to know
        // `bg-surface-hover` conflicts with `[--btn-bg-hover:…]`.
        // The chin's `-ms-2` belongs to its first control only (see
        // CatalogControlsBar); here it made later pickers overlap.
        //
        // In the chin the width is capped: a long selection ("Code Review &
        // Refactoring") otherwise pushes the chin onto two rows. The cut-off
        // label stays readable in the tooltip, the accessible name and the
        // popup's checked row. The sheet's buttons are full-width already.
        // Button wraps its label in a text-box span that won't shrink below
        // its text, so that span needs min-w-0 for the truncate to engage.
        "[&>span>span]:min-w-0",
        inSheet
          ? "[--btn-bg-active:var(--surface-active)] [--btn-bg-hover:var(--surface-hover)] [--btn-bg:var(--input-elevated)] hover:text-foreground"
          : "max-w-44 text-muted-foreground",
        selectionLabel !== null && "text-foreground",
        className,
      )}
      trailingIcon={
        <HugeiconsIcon
          icon={UnfoldMoreIcon}
          strokeWidth={2}
          className="size-4 text-muted-foreground"
        />
      }
    >
      <span
        title={selectionLabel ?? undefined}
        className={cn(
          // The button trims the text box to cap height, so truncate's
          // overflow clip shaved ascenders and descenders. Padding gives the
          // glyphs room inside the clip; the negative margin keeps the layout.
          "-my-1 block truncate py-1",
          selectionLabel === null && "text-muted-foreground",
        )}
      >
        {selectionLabel ?? name}
      </span>
    </Button>
  );
}

/**
 * One width for every picker, fitting the longest category name. Longer
 * publisher domains wrap instead of the popup growing to fit, which would
 * jump in width as results change per keystroke.
 */
export function FilterPickerPopup({
  inSheet,
  children,
}: {
  inSheet: boolean;
  children: React.ReactNode;
}) {
  return (
    <ComboboxPopup
      level={inSheet ? 7 : 5}
      align="start"
      className="flex min-w-80 flex-col p-0"
    >
      {children}
    </ComboboxPopup>
  );
}

export function FilterPickerSearch({
  placeholder,
  busy,
  end,
}: {
  placeholder: string;
  busy?: boolean;
  end?: React.ReactNode;
}) {
  return (
    <div className="border-b border-border p-2">
      <ComboboxInput
        variant="elevated"
        placeholder={placeholder}
        showTrigger={false}
        showClear={false}
        aria-busy={busy}
        start={
          <HugeiconsIcon
            icon={Search01Icon}
            strokeWidth={2}
            className="text-muted-foreground"
          />
        }
        end={end}
      />
    </div>
  );
}

export function FilterPickerClear({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-border p-1">
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start text-muted-foreground"
        onClick={onClick}
        leadingIcon={
          <HugeiconsIcon
            icon={Cancel01Icon}
            strokeWidth={2}
            className="size-3.5"
          />
        }
      >
        {children}
      </Button>
    </div>
  );
}
