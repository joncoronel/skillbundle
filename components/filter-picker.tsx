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

/**
 * The pieces the catalog's combobox filters (Publisher, Category) share, so a
 * styling fix lands in both pickers at once. Each picker still owns its
 * Combobox, items and list: those differ (server-side search vs. a fixed
 * local list).
 */

/**
 * Column override for ComboboxItem rows. The vendored item lays out as
 * `grid-cols-[1fr_1rem]`, and a bare `1fr` track can't shrink below its
 * content's min-content width, so one unbreakable name widened its row past
 * the popup and the list scrolled sideways. `minmax(0,1fr)` lets the track
 * shrink so the name wraps (or fits) inside the popup instead.
 */
export const PICKER_ITEM_COLUMNS = "grid-cols-[minmax(0,1fr)_1rem]";

/**
 * The trigger button. Pass it the `triggerProps` from ComboboxTrigger's
 * render prop.
 *
 * `name` is the filter's name ("Category"). With nothing selected it is the
 * visible label; with a selection the visible label is the selection, and the
 * accessible name carries both, so a screen reader hears what is selected
 * rather than only what the control is for.
 */
export function FilterPickerTrigger({
  triggerProps,
  name,
  selectionLabel,
  inSheet,
  className,
}: {
  triggerProps: React.ComponentProps<"button">;
  name: string;
  /** What is selected ("Testing & QA", "3 categories"), or null for none. */
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
        // Ghost already supplies the hover fill and text colour in the chin.
        // The chin's first control also needs `-ms-2` (see CatalogControlsBar);
        // that belongs to the row's layout, not to this trigger, or every
        // picker after the first overlaps its left neighbour.
        inSheet
          ? "[--btn-bg-active:var(--surface-active)] [--btn-bg-hover:var(--surface-hover)] [--btn-bg:var(--input-elevated)] hover:text-foreground"
          : "text-muted-foreground",
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
        className={cn(
          "truncate",
          selectionLabel === null && "text-muted-foreground",
        )}
      >
        {selectionLabel ?? name}
      </span>
    </Button>
  );
}

/**
 * The popup shell. One width for every picker, so the Category and Publisher
 * popups beside each other match: wide enough for the longest category name
 * with its count and check on one line. Longer publisher domains wrap (see
 * PICKER_ITEM_COLUMNS) rather than the popup growing to fit, because the
 * results change per keystroke and a fitted popup would jump in width.
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

/** The search input pinned to the top of the popup. */
export function FilterPickerSearch({
  placeholder,
  busy,
  end,
}: {
  placeholder: string;
  busy?: boolean;
  /** Trailing slot, e.g. a spinner while a server-side search runs. */
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

/** The "Clear …" footer, shown only while something is selected. */
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
