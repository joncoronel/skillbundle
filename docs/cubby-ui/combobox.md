# Combobox (/docs/components/combobox)

The combobox is a text input paired with a filtered, keyboard-navigable list of options. Use it for searchable selects, tag pickers, async autocompletes, or any select-from-many flow with more options than a dropdown comfortably holds.

## Preview [#preview]

```tsx
// combobox-basic.tsx
"use client";

import {
  Combobox,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxEmpty,
  ComboboxLabel,
} from "@/components/ui/cubby-ui/combobox";

export default function ComboboxBasic() {
  return (
    <Combobox items={fruits}>
      <div className="flex w-full max-w-3xs flex-col gap-1">
        <ComboboxLabel>Choose a fruit</ComboboxLabel>
        <ComboboxInput placeholder="e.g. Apple" />
      </div>
      <ComboboxPopup>
        <ComboboxEmpty>No fruits found.</ComboboxEmpty>
        <ComboboxList>
          {(item: string, index: number) => (
            <ComboboxItem key={index} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

const fruits = [
  "Apple",
  "Banana",
  "Orange",
  "Pineapple",
  "Grape",
  "Mango",
  "Strawberry",
  "Blueberry",
  "Raspberry",
  "Blackberry",
  "Cherry",
  "Peach",
  "Pear",
  "Plum",
  "Kiwi",
  "Watermelon",
  "Cantaloupe",
  "Honeydew",
  "Papaya",
  "Guava",
  "Lychee",
  "Pomegranate",
  "Apricot",
  "Grapefruit",
  "Passionfruit",
];
```

## Installation [#installation]

### Installation

**CLI:**

```bash
npx shadcn@latest add @cubby-ui/combobox
```

**Manual:**

1. Install dependencies:

```bash
npm install @hugeicons/react @hugeicons/core-free-icons
```

2. Copy the component source code to your project:

Create `components/ui/cubby-ui/combobox/combobox.tsx`:

```tsx
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { elevatedSurface, type SurfaceLevel } from "@/lib/cubby-ui/elevated";
import { Label } from "@/components/ui/cubby-ui/label";
import {
  ScrollArea,
  type ScrollAreaProps,
} from "@/components/ui/cubby-ui/scroll-area";
import { Combobox as BaseCombobox } from "@base-ui/react/combobox";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  Cancel01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
const useComboboxFilter = BaseCombobox.useFilter;
const useComboboxFilteredItems = BaseCombobox.useFilteredItems;

// Shared styling for the start/end addon containers. `pointer-events-none` lets
// clicks on decorative content (icons, spinners) fall through to the InputGroup,
// whose Base UI mousedown handler focuses the input; interactive children opt
// back in so buttons/links inside an addon still receive their own clicks.
const comboboxAddonClassName = cn(
  "text-muted-foreground pointer-events-none flex shrink-0 items-center",
  "[&_svg:not([class*='size-'])]:size-4",
  "[&_:is(button,a,input,select,textarea,label,[role=button])]:pointer-events-auto",
);

const ComboboxContext = React.createContext<{
  id: string;
  /** The mounted ComboboxChips element, if any, used to anchor the popup. */
  chipsElement: HTMLDivElement | null;
  setChipsElement: (element: HTMLDivElement | null) => void;
} | null>(null);

function Combobox<Value, Multiple extends boolean | undefined = false>(
  props: BaseCombobox.Root.Props<Value, Multiple>,
): React.JSX.Element {
  const id = React.useId();
  const [chipsElement, setChipsElement] = React.useState<HTMLDivElement | null>(
    null,
  );

  const contextValue = React.useMemo(
    () => ({ id, chipsElement, setChipsElement }),
    [id, chipsElement],
  );

  return (
    <ComboboxContext.Provider value={contextValue}>
      <BaseCombobox.Root data-slot="combobox" {...props} />
    </ComboboxContext.Provider>
  );
}

function ComboboxInput({
  id: idProp,
  className,
  inputClassName,
  showTrigger = true,
  showClear = true,
  variant = "default",
  start,
  end,
  ...props
}: BaseCombobox.Input.Props & {
  showTrigger?: boolean;
  showClear?: boolean;
  variant?: "default" | "elevated";
  /** Content pinned to the start (leading edge) of the field, e.g. a search icon. */
  start?: React.ReactNode;
  /** Content pinned to the end of the field, before Clear and Trigger, e.g. a loading spinner. */
  end?: React.ReactNode;
  /** Class applied to the inner `<input>`. `className` styles the field wrapper. */
  inputClassName?: string;
}) {
  const context = React.useContext(ComboboxContext);
  const id = idProp ?? context?.id;

  return (
    // The wrapper carries the field chrome (border, bg, height, focus ring) so
    // start/end/clear/trigger lay out as flex siblings instead of overlapping
    // the input via absolute positioning + hand-tuned padding.
    <BaseCombobox.InputGroup
      data-slot="combobox-input-group"
      className={cn(
        "flex h-10 w-full min-w-0 cursor-text items-center gap-2 rounded-lg border bg-clip-padding px-3 sm:h-9",
        variant === "default" ? "bg-input" : "bg-input-elevated",
        // Focus ring follows the input via focus-within (same pattern as ComboboxChips).
        "focus-within:outline-ring/50 outline-0 outline-offset-0 outline-transparent transition-[outline-width,outline-offset,outline-color] duration-100 ease-out outline-solid focus-within:outline-2 focus-within:outline-offset-2",
        // Disabled state (input or field-level) dims and locks the whole field.
        "has-[input:disabled]:cursor-not-allowed has-[input:disabled]:pointer-events-none has-[input:disabled]:opacity-60",
        className,
      )}
    >
      {start != null && (
        <div
          data-slot="combobox-input-start"
          className={comboboxAddonClassName}
        >
          {start}
        </div>
      )}
      <BaseCombobox.Input
        id={id}
        data-slot="combobox-input"
        className={cn(
          "placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground h-full min-w-0 flex-1 border-none bg-transparent p-0 text-base font-normal shadow-none outline-none disabled:cursor-not-allowed md:text-sm",
          "file:text-foreground file:inline-flex file:h-7 file:rounded-md file:border-0 file:bg-transparent file:text-sm file:font-medium",
          inputClassName,
        )}
        {...props}
      />
      {end != null && (
        <div data-slot="combobox-input-end" className={comboboxAddonClassName}>
          {end}
        </div>
      )}
      {(showClear || showTrigger) && (
        <div className="flex shrink-0 items-center gap-2">
          {showClear && <ComboboxClear />}
          {showTrigger && <ComboboxTrigger />}
        </div>
      )}
    </BaseCombobox.InputGroup>
  );
}

function ComboboxChipInput({
  id: idProp,
  className,
  ...props
}: BaseCombobox.Input.Props) {
  const context = React.useContext(ComboboxContext);
  const id = idProp ?? context?.id;

  return (
    <BaseCombobox.Input
      id={id}
      data-slot="combobox-input"
      className={cn(
        "placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground h-7 min-w-12 flex-1 rounded-none border-none bg-transparent p-0 pl-1.5 text-base font-normal shadow-none outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60 sm:h-6 md:text-sm",

        className,
      )}
      {...props}
    />
  );
}

function ComboboxTrigger({
  className,
  children,
  ...props
}: BaseCombobox.Trigger.Props) {
  return (
    <BaseCombobox.Trigger
      data-slot="combobox-trigger"
      aria-label="Open popup"
      className={cn(
        "inline-flex size-4 cursor-pointer items-center justify-center rounded-md border-none bg-transparent p-0 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-60",
        "focus-visible:ring-ring/70 outline-none focus-visible:ring-2",
        className,
      )}
      {...props}
    >
      {children ?? (
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className="h-4 w-4"
          strokeWidth={2}
        />
      )}
    </BaseCombobox.Trigger>
  );
}

function ComboboxIcon({
  className,
  ...props
}: React.ComponentProps<typeof BaseCombobox.Icon>) {
  return (
    <BaseCombobox.Icon
      data-slot="combobox-icon"
      className={cn("ml-2 h-4 w-4 shrink-0 opacity-50", className)}
      {...props}
    />
  );
}

function ComboboxClear({ className, ...props }: BaseCombobox.Clear.Props) {
  return (
    <BaseCombobox.Clear
      data-slot="combobox-clear"
      aria-label="Clear selection"
      className={cn(
        "inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-sm opacity-70 transition-[opacity,scale,transform,translate] hover:opacity-100 disabled:pointer-events-none",
        "focus-visible:ring-ring/70 duration-100 outline-none focus-visible:ring-2",
        "data-ending-style:translate-x-1 data-ending-style:opacity-0 data-starting-style:translate-x-1 data-starting-style:opacity-0",
        className,
      )}
      {...props}
    >
      <HugeiconsIcon icon={Cancel01Icon} className="h-4 w-4" strokeWidth={2} />
    </BaseCombobox.Clear>
  );
}

function ComboboxValue({ ...props }: BaseCombobox.Value.Props) {
  return <BaseCombobox.Value data-slot="combobox-value" {...props} />;
}

function ComboboxPortal({ ...props }: BaseCombobox.Portal.Props) {
  return <BaseCombobox.Portal data-slot="combobox-portal" {...props} />;
}

function ComboboxBackdrop({
  className,
  ...props
}: BaseCombobox.Backdrop.Props) {
  return (
    <BaseCombobox.Backdrop
      data-slot="combobox-backdrop"
      className={cn(
        "fixed inset-0 z-30 bg-black/50 data-ending-style:opacity-0 data-starting-style:opacity-0",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxPositioner({
  className,
  ...props
}: BaseCombobox.Positioner.Props) {
  return (
    <BaseCombobox.Positioner
      data-slot="combobox-positioner"
      sideOffset={6}
      className={cn("", className)}
      {...props}
    />
  );
}

function ComboboxPopupPrimitive({
  className,
  level = 3,
  shadowLevel = 3,
  ...props
}: BaseCombobox.Popup.Props & {
  /** Surface elevation level for the popup bg (1-8). Bump when nesting inside a Dialog. Defaults to 3. */
  level?: SurfaceLevel;
  /** Shadow weight (1-8). Pinned to 3 by default so the combobox reads the same regardless of nesting depth. */
  shadowLevel?: SurfaceLevel;
}) {
  return (
    <BaseCombobox.Popup
      data-slot="combobox-popup"
      data-level={level}
      className={cn(
        "text-popover-foreground ease-out-expo flex max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) origin-(--transform-origin) flex-col overflow-clip overscroll-contain rounded-xl transition-[transform,scale,opacity] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
        // Use elevatedSurface (rim on ::after) because combobox group labels are
        // often sticky and would otherwise hide the rim where they sit.
        elevatedSurface(level, shadowLevel),
        className,
      )}
      {...props}
    />
  );
}

function ComboboxArrow({ className, ...props }: BaseCombobox.Arrow.Props) {
  return (
    <BaseCombobox.Arrow
      data-slot="combobox-arrow"
      className={cn(
        "data-[side=bottom]:top-[-8px] data-[side=left]:right-[-13px] data-[side=left]:rotate-90 data-[side=right]:left-[-13px] data-[side=right]:-rotate-90 data-[side=top]:bottom-[-8px] data-[side=top]:rotate-180",
        className,
      )}
      {...props}
    >
      <svg width="20" height="10" viewBox="0 0 20 10" fill="none">
        <path
          d="M9.66437 2.60207L4.80758 6.97318C4.07308 7.63423 3.11989 8 2.13172 8H0V9H20V8H18.5349C17.5468 8 16.5936 7.63423 15.8591 6.97318L11.0023 2.60207C10.622 2.2598 10.0447 2.25979 9.66437 2.60207Z"
          className="fill-(--popup-surface,var(--popover))"
        />
        <path
          d="M10.3333 3.34539L5.47654 7.71648C4.55842 8.54279 3.36693 9 2.13172 9H0V8H2.13172C3.11989 8 4.07308 7.63423 4.80758 6.97318L9.66437 2.60207C10.0447 2.25979 10.622 2.2598 11.0023 2.60207L15.8591 6.97318C16.5936 7.63423 17.5468 8 18.5349 8H20V9H18.5349C17.2998 9 16.1083 8.54278 15.1901 7.71648L10.3333 3.34539Z"
          className="fill-border/70"
        />
      </svg>
    </BaseCombobox.Arrow>
  );
}

function ComboboxStatus({ className, ...props }: BaseCombobox.Status.Props) {
  return (
    <BaseCombobox.Status
      data-slot="combobox-status"
      className={cn(
        "text-muted-foreground px-3 py-2.5 text-sm leading-5 empty:m-0 empty:p-0",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxEmpty({ className, ...props }: BaseCombobox.Empty.Props) {
  return (
    <BaseCombobox.Empty
      data-slot="combobox-empty"
      className={cn(
        "text-muted-foreground px-3 py-2.5 text-sm empty:m-0 empty:p-0",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxList({
  className,
  nativeScroll = false,
  fadeEdges = true,
  scrollbarGutter = false,
  persistScrollbar,
  hideScrollbar,
  ...props
}: BaseCombobox.List.Props &
  Pick<
    ScrollAreaProps,
    | "nativeScroll"
    | "fadeEdges"
    | "scrollbarGutter"
    | "persistScrollbar"
    | "hideScrollbar"
  >) {
  return (
    <ScrollArea
      nativeScroll={nativeScroll}
      fadeEdges={fadeEdges}
      scrollbarGutter={scrollbarGutter}
      persistScrollbar={persistScrollbar}
      hideScrollbar={hideScrollbar}
      className={cn("max-h-80", className)}
    >
      <BaseCombobox.List
        data-slot="combobox-list"
        className="rounded-xl"
        {...props}
      />
    </ScrollArea>
  );
}

function ComboboxVirtualizedList({
  className,
  children,
  scrollRef,
  totalSize,
  emptyMessage = "No results found.",
  fadeEdges = "y",
  nativeScroll = false,
  ...props
}: Omit<React.ComponentProps<"div">, "ref"> &
  Pick<ScrollAreaProps, "fadeEdges" | "nativeScroll"> & {
    scrollRef: (element: HTMLDivElement | null) => void;
    totalSize: number;
    emptyMessage?: React.ReactNode;
  }) {
  return (
    <>
      <BaseCombobox.Empty
        data-slot="combobox-empty"
        className="text-muted-foreground px-3 py-2.5 text-sm empty:m-0 empty:p-0"
      >
        {emptyMessage}
      </BaseCombobox.Empty>
      <BaseCombobox.List
        data-slot="combobox-list"
        className="w-full flex-1 overflow-hidden rounded-xl p-0 outline-hidden empty:m-0 empty:p-0"
      >
        <ScrollArea
          viewportRef={scrollRef}
          viewportClassName={cn("scroll-py-2", className)}
          fadeEdges={fadeEdges}
          nativeScroll={nativeScroll}
          className="h-auto max-h-80 w-full"
          {...props}
        >
          <div
            role="presentation"
            className="relative w-full"
            style={{ height: totalSize }}
          >
            {children}
          </div>
        </ScrollArea>
      </BaseCombobox.List>
    </>
  );
}

function ComboboxCollection({ ...props }: BaseCombobox.Collection.Props) {
  return <BaseCombobox.Collection data-slot="combobox-collection" {...props} />;
}

function ComboboxRow({ className, ...props }: BaseCombobox.Row.Props) {
  return (
    <BaseCombobox.Row
      data-slot="combobox-row"
      className={cn("flex", className)}
      {...props}
    />
  );
}

function ComboboxItem({
  className,
  children,
  ref,
  ...props
}: BaseCombobox.Item.Props & {
  ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <BaseCombobox.Item
      ref={ref}
      data-slot="combobox-item"
      className={cn(
        "data-highlighted:text-accent-foreground data-highlighted:bg-surface-hover relative grid cursor-default grid-cols-[1fr_1rem] items-center gap-2 rounded-md px-2.5 py-2 pr-2 text-sm outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-60",
        // Spacing from list edges
        "mx-1 first:mt-1 last:mb-1",
        className,
      )}
      {...props}
    >
      <div className="break-all">{children}</div>
      <BaseCombobox.ItemIndicator
        render={
          <HugeiconsIcon icon={Tick02Icon} className="size-4" strokeWidth={2} />
        }
      />
    </BaseCombobox.Item>
  );
}

function ComboboxItemIndicator({
  className,
  ...props
}: BaseCombobox.ItemIndicator.Props) {
  return (
    <BaseCombobox.ItemIndicator
      data-slot="combobox-item-indicator"
      className={cn("", className)}
      {...props}
    />
  );
}

function ComboboxGroup({ className, ...props }: BaseCombobox.Group.Props) {
  return (
    <BaseCombobox.Group
      data-slot="combobox-group"
      className={cn("text-foreground block", className)}
      {...props}
    />
  );
}

function ComboboxGroupLabel({
  className,
  ...props
}: BaseCombobox.GroupLabel.Props) {
  return (
    <BaseCombobox.GroupLabel
      data-slot="combobox-group-label"
      className={cn(
        "text-muted-foreground bg-(--popup-surface,var(--popover)) px-3.5 py-1.5 pt-2.5 text-xs font-semibold",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxSeparator({
  className,
  ...props
}: BaseCombobox.Separator.Props) {
  return (
    <BaseCombobox.Separator
      data-slot="combobox-separator"
      className={cn("bg-border mx-1 my-1 h-px min-h-px", className)}
      {...props}
    />
  );
}

function ComboboxChips({
  className,
  variant = "default",
  ...props
}: BaseCombobox.Chips.Props & { variant?: "default" | "elevated" }) {
  const context = React.useContext(ComboboxContext);

  return (
    <BaseCombobox.Chips
      ref={context?.setChipsElement}
      data-slot="combobox-chips"
      className={cn(
        "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-lg border bg-clip-padding px-1.5 py-1.5",
        variant === "default" ? "bg-input" : "bg-input-elevated",
        "focus-within:outline-ring/50 outline-0 outline-offset-0 outline-transparent transition-[outline-width,outline-offset,outline-color] duration-100 ease-out outline-solid focus-within:outline-2 focus-within:outline-offset-2",

        className,
      )}
      {...props}
    />
  );
}

function ComboboxChip({ className, ...props }: BaseCombobox.Chip.Props) {
  return (
    <BaseCombobox.Chip
      data-slot="combobox-chip"
      className={cn(
        "bg-surface-selected text-accent-foreground flex items-center gap-1 rounded-sm px-2 py-1 text-sm font-medium break-all sm:text-xs",
        // Ring (not outline) avoids clipping neighbors in the packed chip row;
        // outline-none suppresses the browser default (currentColor → white in dark mode).
        "focus-visible:ring-ring/70 outline-none focus-visible:ring-2",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxChipRemove({
  className,
  ...props
}: BaseCombobox.ChipRemove.Props) {
  return (
    <BaseCombobox.ChipRemove
      data-slot="combobox-chip-remove"
      className={cn(
        "ml-1 inline-flex h-4 w-4 items-center justify-center rounded-sm opacity-70 transition-opacity hover:opacity-100 disabled:pointer-events-none",
        "focus-visible:ring-ring/70 cursor-pointer outline-none focus-visible:ring-2",
        className,
      )}
      {...props}
    />
  );
}

function ComboboxPopup({
  className,
  children,
  sideOffset = 6,
  backdrop = false,
  level,
  shadowLevel,
  ...props
}: BaseCombobox.Popup.Props & {
  sideOffset?: number;
  backdrop?: boolean;
  /** Surface elevation level for the popup bg (1-8). Defaults to 3. */
  level?: SurfaceLevel;
  /** Shadow weight (1-8). Defaults to 3. */
  shadowLevel?: SurfaceLevel;
}) {
  const context = React.useContext(ComboboxContext);

  return (
    <ComboboxPortal>
      {backdrop && <ComboboxBackdrop />}
      {/*
       * Only anchor to the chips wrapper when chips are actually mounted.
       * Otherwise pass no anchor so Base UI uses its default: the InputGroup
       * (full field width) for a standard input, or the trigger for the
       * input-inside-popup pattern. Forcing an anchor here would pin the popup
       * to the narrower inner <input>.
       */}
      <ComboboxPositioner
        anchor={context?.chipsElement ?? undefined}
        sideOffset={sideOffset}
      >
        <ComboboxPopupPrimitive
          className={className}
          level={level}
          shadowLevel={shadowLevel}
          {...props}
        >
          {children}
        </ComboboxPopupPrimitive>
      </ComboboxPositioner>
    </ComboboxPortal>
  );
}

function ComboboxLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>) {
  const context = React.useContext(ComboboxContext);

  return <Label htmlFor={context?.id} className={className} {...props} />;
}

function ComboboxTriggerLabel({
  className,
  ...props
}: BaseCombobox.Label.Props) {
  return (
    <BaseCombobox.Label
      data-slot="combobox-trigger-label"
      className={cn(
        "text-foreground text-sm leading-5 font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-60 peer-disabled:cursor-not-allowed peer-disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export {
  Combobox,
  ComboboxInput,
  ComboboxChipInput,
  ComboboxTrigger,
  ComboboxIcon,
  ComboboxClear,
  ComboboxValue,
  ComboboxPortal,
  ComboboxBackdrop,
  ComboboxPositioner,
  ComboboxPopupPrimitive,
  ComboboxPopup,
  ComboboxArrow,
  ComboboxStatus,
  ComboboxEmpty,
  ComboboxList,
  ComboboxCollection,
  ComboboxRow,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxSeparator,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipRemove,
  ComboboxVirtualizedList,
  ComboboxLabel,
  ComboboxTriggerLabel,
  useComboboxFilter,
  useComboboxFilteredItems,
};
```

Create `components/ui/cubby-ui/combobox/hooks/use-async-combobox.ts`:

````tsx
import * as React from "react";

export interface UseAsyncComboboxOptions<T extends { id: string }> {
  /**
   * Async search function that receives the query and an AbortSignal.
   * Should return an array of items matching the query.
   */
  searchFn: (query: string, signal: AbortSignal) => Promise<T[]>;

  /**
   * Debounce delay in milliseconds. Defaults to 0 (no debounce).
   */
  debounceMs?: number;
}

export interface UseAsyncComboboxSingleOptions<
  T extends { id: string },
> extends UseAsyncComboboxOptions<T> {
  /**
   * Whether multiple selection is enabled
   */
  multiple?: false;

  /**
   * Controlled selected value
   */
  value?: T | null;

  /**
   * Callback when value changes
   */
  onValueChange?: (value: T | null) => void;
}

export interface UseAsyncComboboxMultipleOptions<
  T extends { id: string },
> extends UseAsyncComboboxOptions<T> {
  /**
   * Whether multiple selection is enabled
   */
  multiple: true;

  /**
   * Controlled selected values
   */
  value?: T[];

  /**
   * Callback when values change
   */
  onValueChange?: (value: T[]) => void;
}

export interface UseAsyncComboboxReturn<T extends { id: string }> {
  /**
   * Items array with search results merged with selected values.
   * Selected values are always kept in the list during search.
   */
  items: T[];

  /**
   * Props to spread onto the Combobox component
   */
  comboboxProps: {
    inputValue: string;
    onInputValueChange: (
      value: string,
      details: { reason: string; event: Event | React.SyntheticEvent },
    ) => void;
    filter: null;
    onOpenChangeComplete: (open: boolean) => void;
  };

  /**
   * Whether a search is in progress
   */
  isPending: boolean;

  /**
   * Error message if the search failed
   */
  error: string | null;

  /**
   * Trimmed input value for status message logic
   */
  query: string;
}

/**
 * Hook to manage async search combobox state and logic
 *
 * This hook encapsulates the complex logic needed for async search:
 * - AbortController for canceling in-flight requests
 * - useTransition for pending states
 * - Merging search results with selected values to keep them visible
 * - Clearing results when popup closes
 *
 * @example
 * ```tsx
 * const [value, setValue] = useState<Employee | null>(null);
 *
 * const { items, comboboxProps, isPending, error, query } = useAsyncCombobox({
 *   searchFn: searchEmployees,
 *   value,
 *   onValueChange: setValue,
 * });
 *
 * <Combobox items={items} value={value} onValueChange={setValue} {...comboboxProps}>
 *   ...
 * </Combobox>
 * ```
 */
export function useAsyncCombobox<T extends { id: string }>(
  options: UseAsyncComboboxSingleOptions<T>,
): UseAsyncComboboxReturn<T>;
export function useAsyncCombobox<T extends { id: string }>(
  options: UseAsyncComboboxMultipleOptions<T>,
): UseAsyncComboboxReturn<T>;
export function useAsyncCombobox<T extends { id: string }>({
  searchFn,
  debounceMs = 0,
  multiple,
  value,
  onValueChange,
}:
  | UseAsyncComboboxSingleOptions<T>
  | UseAsyncComboboxMultipleOptions<T>): UseAsyncComboboxReturn<T> {
  const [searchResults, setSearchResults] = React.useState<T[]>([]);
  const [inputValue, setInputValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  const abortControllerRef = React.useRef<AbortController | null>(null);
  const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const query = inputValue.trim();

  // Merge search results with selected values to keep them visible
  const items = React.useMemo(() => {
    if (multiple) {
      const selectedValues = (value as T[] | undefined) ?? [];
      if (selectedValues.length === 0) {
        return searchResults;
      }
      // Add selected values that aren't already in search results
      const searchIds = new Set(searchResults.map((item) => item.id));
      const missingSelected = selectedValues.filter(
        (item) => !searchIds.has(item.id),
      );
      return [...searchResults, ...missingSelected];
    } else {
      const selectedValue = value as T | null | undefined;
      if (
        !selectedValue ||
        searchResults.some((item) => item.id === selectedValue.id)
      ) {
        return searchResults;
      }
      return [...searchResults, selectedValue];
    }
  }, [searchResults, value, multiple]);

  // Perform search
  const performSearch = React.useCallback(
    (searchQuery: string) => {
      // Cancel any previous request
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      startTransition(async () => {
        setError(null);

        try {
          const results = await searchFn(searchQuery, controller.signal);

          if (controller.signal.aborted) {
            return;
          }

          startTransition(() => {
            setSearchResults(results);
          });
        } catch (err) {
          if (controller.signal.aborted) {
            return;
          }

          const message =
            err instanceof Error ? err.message : "Search failed. Try again.";
          setError(message);
          setSearchResults([]);
        }
      });
    },
    [searchFn],
  );

  // Handle input value changes
  const handleInputValueChange = React.useCallback(
    (
      nextValue: string,
      details: { reason: string; event: Event | React.SyntheticEvent },
    ) => {
      setInputValue(nextValue);

      // Don't search if input was cleared due to item selection
      if (details.reason === "item-press") {
        return;
      }

      // Clear debounce timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      const trimmed = nextValue.trim();

      if (trimmed === "") {
        setSearchResults([]);
        setError(null);
        abortControllerRef.current?.abort();
        return;
      }

      // Debounce the search
      if (debounceMs > 0) {
        debounceTimerRef.current = setTimeout(() => {
          performSearch(trimmed);
        }, debounceMs);
      } else {
        performSearch(trimmed);
      }
    },
    [debounceMs, performSearch],
  );

  // Handle popup close - reset to only show selected values
  const handleOpenChangeComplete = React.useCallback(
    (open: boolean) => {
      if (!open) {
        if (multiple) {
          const selectedValues = (value as T[] | undefined) ?? [];
          setSearchResults(selectedValues);
          // Clear input for multiple selection (chips show the selections)
          setInputValue("");
        } else {
          const selectedValue = value as T | null | undefined;
          setSearchResults(selectedValue ? [selectedValue] : []);
          // Don't clear input for single selection - Base UI handles
          // displaying the selected value via itemToStringLabel
        }
        setError(null);
      }
    },
    [value, multiple],
  );

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return {
    items,
    comboboxProps: {
      inputValue,
      onInputValueChange: handleInputValueChange,
      filter: null,
      onOpenChangeComplete: handleOpenChangeComplete,
    },
    isPending,
    error,
    query,
  };
}
````

Create `components/ui/cubby-ui/combobox/hooks/use-creatable-combobox.ts`:

````tsx
import * as React from "react";

export interface UseCreatableComboboxOptions<
  T extends { id: string; value: string },
> {
  /**
   * Controlled items for the combobox
   */
  items: T[];

  /**
   * Callback when items change
   */
  onItemsChange: (items: T[]) => void;

  /**
   * Controlled selected items
   */
  selectedItems: T[];

  /**
   * Callback when selected items change
   */
  onSelectedItemsChange: (items: T[]) => void;
}

export interface UseCreatableComboboxReturn<
  T extends { id: string; value: string },
> {
  /**
   * Items array with pseudo "Create X" item injected when applicable
   */
  itemsWithCreatable: Array<T & { creatable?: string }>;

  /**
   * Props to spread onto the Combobox component
   */
  comboboxProps: {
    value: T[];
    onValueChange: (value: unknown) => void;
    inputValue: string;
    onInputValueChange: (value: string) => void;
    onOpenChange: (
      open: boolean,
      details: { event: Event | React.SyntheticEvent },
    ) => void;
  };

  /**
   * Props to spread onto the Dialog component
   */
  dialogProps: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  };

  /**
   * Props to spread onto the dialog input element
   */
  dialogInputProps: {
    ref: React.RefObject<HTMLInputElement | null>;
    defaultValue: string;
  };

  /**
   * Form submit handler (handles preventDefault internally)
   */
  onDialogSubmit: (event: React.FormEvent<HTMLFormElement>) => void;

  /**
   * Dialog cancel handler
   */
  handleCancel: () => void;
}

/**
 * Slugify a string to create a valid ID
 */
function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]/g, "");
}

/**
 * Generate a unique ID from a value, handling collisions
 */
function generateUniqueId<T extends { id: string }>(
  value: string,
  existingItems: T[],
): string {
  const baseId = slugify(value);
  const existingIds = new Set(existingItems.map((item) => item.id));

  let uniqueId = baseId;
  if (existingIds.has(uniqueId)) {
    let counter = 2;
    while (existingIds.has(`${baseId}-${counter}`)) {
      counter += 1;
    }
    uniqueId = `${baseId}-${counter}`;
  }

  return uniqueId;
}

/**
 * Hook to manage creatable combobox state and logic
 *
 * This hook encapsulates all the complex logic needed for a creatable combobox:
 * - Injecting a pseudo "Create X" item when the query doesn't match existing items
 * - Handling item creation via a confirmation dialog with automatic ID generation
 * - Normalizing values and checking for duplicates
 *
 * @example
 * ```tsx
 * const [items, setItems] = useState(initialLabels);
 * const [selectedItems, setSelectedItems] = useState<LabelItem[]>([]);
 *
 * const { itemsWithCreatable, comboboxProps, dialogProps, dialogInputProps, onDialogSubmit, handleCancel } =
 *   useCreatableCombobox({
 *     items,
 *     onItemsChange: setItems,
 *     selectedItems,
 *     onSelectedItemsChange: setSelectedItems,
 *   });
 * ```
 */
export function useCreatableCombobox<T extends { id: string; value: string }>({
  items,
  onItemsChange,
  selectedItems,
  onSelectedItemsChange,
}: UseCreatableComboboxOptions<T>): UseCreatableComboboxReturn<T> {
  const [query, setQuery] = React.useState("");
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [pendingValue, setPendingValue] = React.useState("");

  const inputRef = React.useRef<HTMLInputElement>(null);

  // Helper to normalize values for comparison
  const normalize = React.useCallback((value: string) => {
    return value.trim().toLowerCase();
  }, []);

  // Helper to check if an item already exists
  const itemExists = React.useCallback(
    (value: string) => {
      const normalized = normalize(value);
      return items.some((item) => normalize(item.value) === normalized);
    },
    [items, normalize],
  );

  // Create the items array with pseudo "Create X" item if needed
  const itemsWithCreatable = React.useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed || itemExists(trimmed)) {
      return items;
    }

    // Add pseudo item
    const normalized = normalize(trimmed);
    return [
      ...items,
      {
        id: `create:${normalized}`,
        value: `Create "${trimmed}"`,
        creatable: trimmed,
      } as T & { creatable: string },
    ];
  }, [items, query, itemExists, normalize]);

  // Handle item creation
  const handleCreate = React.useCallback(() => {
    const value = pendingValue.trim();
    if (!value) return;

    // Check if item already exists
    if (itemExists(value)) {
      const existing = items.find(
        (item) => normalize(item.value) === normalize(value),
      );
      if (existing && !selectedItems.some((item) => item.id === existing.id)) {
        onSelectedItemsChange([...selectedItems, existing]);
      }
      setDialogOpen(false);
      setQuery("");
      setPendingValue("");
      return;
    }

    // Create new item with auto-generated ID
    const id = generateUniqueId(value, items);
    const newItem = { id, value } as T;

    onItemsChange([...items, newItem]);
    onSelectedItemsChange([...selectedItems, newItem]);
    setDialogOpen(false);
    setQuery("");
    setPendingValue("");
  }, [
    pendingValue,
    items,
    selectedItems,
    onItemsChange,
    onSelectedItemsChange,
    itemExists,
    normalize,
  ]);

  // Handle value change from combobox
  const handleValueChange = React.useCallback(
    (value: unknown) => {
      const valueArray = Array.isArray(value) ? value : value ? [value] : [];
      const last = valueArray[valueArray.length - 1];

      // Check if the last selected item is the pseudo "Create X" item
      if (last && "creatable" in last && last.creatable) {
        setPendingValue(last.creatable);
        setDialogOpen(true);
        return;
      }

      // Filter out any pseudo items and update selected
      const cleanValue = valueArray.filter(
        (item) => !("creatable" in item && item.creatable),
      );
      onSelectedItemsChange(cleanValue as T[]);
      setQuery("");
    },
    [onSelectedItemsChange],
  );

  // Handle combobox open/close - intercept Enter key to open dialog
  const handleOpenChange = React.useCallback(
    (open: boolean, details: { event: Event | React.SyntheticEvent }) => {
      // Check if Enter key was pressed with a query that doesn't match
      if (
        "key" in details.event &&
        (details.event as KeyboardEvent).key === "Enter"
      ) {
        const trimmed = query.trim();
        if (!trimmed) return;

        // Check if item exists
        if (itemExists(trimmed)) {
          const existing = items.find(
            (item) => normalize(item.value) === normalize(trimmed),
          );
          if (
            existing &&
            !selectedItems.some((item) => item.id === existing.id)
          ) {
            onSelectedItemsChange([...selectedItems, existing]);
          }
          setQuery("");
          return;
        }

        // Open dialog for new item creation
        setPendingValue(trimmed);
        setDialogOpen(true);
      }
    },
    [query, items, selectedItems, itemExists, normalize, onSelectedItemsChange],
  );

  // Dialog submit handler
  const onDialogSubmit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      handleCreate();
    },
    [handleCreate],
  );

  // Dialog cancel handler
  const handleCancel = React.useCallback(() => {
    setDialogOpen(false);
    setPendingValue("");
  }, []);

  return {
    itemsWithCreatable,
    comboboxProps: {
      value: selectedItems,
      onValueChange: handleValueChange,
      inputValue: query,
      onInputValueChange: setQuery,
      onOpenChange: handleOpenChange,
    },
    dialogProps: {
      open: dialogOpen,
      onOpenChange: setDialogOpen,
    },
    dialogInputProps: {
      ref: inputRef,
      defaultValue: pendingValue,
    },
    onDialogSubmit,
    handleCancel,
  };
}
````

Create `lib/cubby-ui/elevated.tsx`:

```tsx
import type * as React from "react";

import { cn } from "@/lib/utils";

export type SurfaceLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const SURFACE_BG: Record<SurfaceLevel, string> = {
  1: "bg-surface-1",
  2: "bg-surface-2",
  3: "bg-surface-3",
  4: "bg-surface-4",
  5: "bg-surface-5",
  6: "bg-surface-6",
  7: "bg-surface-7",
  8: "bg-surface-8",
};

export const SURFACE_SHADOW: Record<SurfaceLevel, string> = {
  1: "shadow-surface-1",
  2: "shadow-surface-2",
  3: "shadow-surface-3",
  4: "shadow-surface-4",
  5: "shadow-surface-5",
  6: "shadow-surface-6",
  7: "shadow-surface-7",
  8: "shadow-surface-8",
};

export const SURFACE_RIM: Record<SurfaceLevel, string> = {
  1: "after:shadow-surface-rim-1",
  2: "after:shadow-surface-rim-2",
  3: "after:shadow-surface-rim-3",
  4: "after:shadow-surface-rim-4",
  5: "after:shadow-surface-rim-5",
  6: "after:shadow-surface-rim-6",
  7: "after:shadow-surface-rim-7",
  8: "after:shadow-surface-rim-8",
};

/**
 * Exposes the surface level to descendants as `--popup-surface` so children
 * (arrow fills, sticky labels, fade gradients) can track the popup's level
 * via `bg-(--popup-surface,var(--popover))`.
 */
export const SURFACE_VAR: Record<SurfaceLevel, string> = {
  1: "[--popup-surface:var(--surface-1)]",
  2: "[--popup-surface:var(--surface-2)]",
  3: "[--popup-surface:var(--surface-3)]",
  4: "[--popup-surface:var(--surface-4)]",
  5: "[--popup-surface:var(--surface-5)]",
  6: "[--popup-surface:var(--surface-6)]",
  7: "[--popup-surface:var(--surface-7)]",
  8: "[--popup-surface:var(--surface-8)]",
};

/**
 * Drops + rim insets in a single `box-shadow` (no `::after`). Used by `solidSurface()`.
 * Literal Tailwind classes so the scanner picks them up.
 */
export const SURFACE_SHADOW_COMBINED: Record<SurfaceLevel, string> = {
  1: "shadow-[var(--surface-shadow-1),var(--surface-rim-1)]",
  2: "shadow-[var(--surface-shadow-2),var(--surface-rim-2)]",
  3: "shadow-[var(--surface-shadow-3),var(--surface-rim-3)]",
  4: "shadow-[var(--surface-shadow-4),var(--surface-rim-4)]",
  5: "shadow-[var(--surface-shadow-5),var(--surface-rim-5)]",
  6: "shadow-[var(--surface-shadow-6),var(--surface-rim-6)]",
  7: "shadow-[var(--surface-shadow-7),var(--surface-rim-7)]",
  8: "shadow-[var(--surface-shadow-8),var(--surface-rim-8)]",
};

export function surfaceClasses(
  level: SurfaceLevel,
  shadowLevel: SurfaceLevel = level,
): string {
  return `${SURFACE_BG[level]} ${SURFACE_SHADOW[shadowLevel]} ${SURFACE_VAR[level]}`;
}

/**
 * Like `surfaceClasses`, but adds a `::after` overlay that re-paints the rim
 * above the container's children. Use on elevated containers with opaque
 * children near their edges (sticky labels, pinned inputs, dialog headers).
 *
 * Host requirements: positioned, `border-radius` class, clipped overflow.
 * Overlay is `z-index: 2` — bump if children exceed that.
 */
export function elevatedSurface(
  level: SurfaceLevel,
  shadowLevel: SurfaceLevel = level,
): string {
  return `${SURFACE_BG[level]} ${SURFACE_SHADOW[shadowLevel]} ${SURFACE_RIM[level]} ${SURFACE_VAR[level]} after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:z-[2]`;
}

/**
 * Like `elevatedSurface`, but paints the rim in the popup's own `box-shadow`
 * (no `::after`) — leaves `::after` free for other purposes. Use for elevated
 * containers with no opaque children near their edges; switch to
 * `elevatedSurface()` if you add a sticky/opaque child.
 *
 * When `level !== shadowLevel` the rim color tracks `shadowLevel`; for
 * independent rim/drop control use `elevatedSurface` instead.
 */
export function solidSurface(
  level: SurfaceLevel,
  shadowLevel: SurfaceLevel = level,
): string {
  return `${SURFACE_BG[level]} ${SURFACE_SHADOW_COMBINED[shadowLevel]} ${SURFACE_VAR[level]}`;
}

/**
 * `::after` classes for a 1px inset rim on a single edge — for viewport-flush
 * containers (Sheet/Drawer) so the rim only shows on the inner-facing edge.
 * Color is `--surface-rim-color` (transparent in light, ~4% white in dark).
 */
export const SURFACE_RIM_EDGE: Record<
  "top" | "bottom" | "left" | "right",
  string
> = {
  top: "after:shadow-[inset_0_1px_0_0_var(--surface-rim-color)]",
  bottom: "after:shadow-[inset_0_-1px_0_0_var(--surface-rim-color)]",
  left: "after:shadow-[inset_1px_0_0_0_var(--surface-rim-color)]",
  right: "after:shadow-[inset_-1px_0_0_0_var(--surface-rim-color)]",
};

/**
 * `::after` overlay with a 1px rim on the specified inner-facing edge.
 * Pair with `surfaceClasses()` (NOT `elevatedSurface()`) for flush variants.
 */
export function innerEdgeRim(
  innerEdge: "top" | "bottom" | "left" | "right",
): string {
  return `after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:z-[2] ${SURFACE_RIM_EDGE[innerEdge]}`;
}

/** Maps attach-side → inner-facing edge for `innerEdgeRim`. */
export const INNER_EDGE_FROM_ATTACH_SIDE: Record<
  "top" | "bottom" | "left" | "right",
  "top" | "bottom" | "left" | "right"
> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

/**
 * Directional drop shadow for a viewport-flush surface: casts toward the
 * inner-facing edge (into the content) rather than always straight down. A
 * flush surface only sheds shadow on the one edge that isn't pinned to the
 * viewport, so the radial `--surface-shadow-N` recipe (which casts down on
 * every surface) points the wrong way for top/bottom/left attach sides.
 *
 * This is the level-5 recipe, rotated per edge. It matches the floating
 * variant's edge ring EXACTLY by mirroring how that recipe handles the ring
 * per mode: the base shadow uses --surface-shadow-ring (light: 6%) and the
 * `dark:` shadow inlines oklch(0 0 0 / 0.16) (the level-5 dark ring). The drop
 * layers reference --surface-shadow-near/mid/far, which already redefine per
 * mode, so they're identical between the two and don't need splitting.
 * The ring casts on all four edges — the three viewport-pinned ones fall
 * off-screen.
 */
export const INNER_EDGE_SHADOW: Record<
  "top" | "bottom" | "left" | "right",
  string
> = {
  left: "shadow-[0_0_0_1px_var(--surface-shadow-ring),-1px_0_1px_-0.5px_var(--surface-shadow-near),-3px_0_3px_-1.5px_var(--surface-shadow-mid),-6px_0_6px_-3px_var(--surface-shadow-mid),-12px_0_12px_-6px_var(--surface-shadow-far)] dark:shadow-[0_0_0_1px_oklch(0_0_0/0.16),-1px_0_1px_-0.5px_var(--surface-shadow-near),-3px_0_3px_-1.5px_var(--surface-shadow-mid),-6px_0_6px_-3px_var(--surface-shadow-mid),-12px_0_12px_-6px_var(--surface-shadow-far)]",
  right:
    "shadow-[0_0_0_1px_var(--surface-shadow-ring),1px_0_1px_-0.5px_var(--surface-shadow-near),3px_0_3px_-1.5px_var(--surface-shadow-mid),6px_0_6px_-3px_var(--surface-shadow-mid),12px_0_12px_-6px_var(--surface-shadow-far)] dark:shadow-[0_0_0_1px_oklch(0_0_0/0.16),1px_0_1px_-0.5px_var(--surface-shadow-near),3px_0_3px_-1.5px_var(--surface-shadow-mid),6px_0_6px_-3px_var(--surface-shadow-mid),12px_0_12px_-6px_var(--surface-shadow-far)]",
  top: "shadow-[0_0_0_1px_var(--surface-shadow-ring),0_-1px_1px_-0.5px_var(--surface-shadow-near),0_-3px_3px_-1.5px_var(--surface-shadow-mid),0_-6px_6px_-3px_var(--surface-shadow-mid),0_-12px_12px_-6px_var(--surface-shadow-far)] dark:shadow-[0_0_0_1px_oklch(0_0_0/0.16),0_-1px_1px_-0.5px_var(--surface-shadow-near),0_-3px_3px_-1.5px_var(--surface-shadow-mid),0_-6px_6px_-3px_var(--surface-shadow-mid),0_-12px_12px_-6px_var(--surface-shadow-far)]",
  bottom:
    "shadow-[0_0_0_1px_var(--surface-shadow-ring),0_1px_1px_-0.5px_var(--surface-shadow-near),0_3px_3px_-1.5px_var(--surface-shadow-mid),0_6px_6px_-3px_var(--surface-shadow-mid),0_12px_12px_-6px_var(--surface-shadow-far)] dark:shadow-[0_0_0_1px_oklch(0_0_0/0.16),0_1px_1px_-0.5px_var(--surface-shadow-near),0_3px_3px_-1.5px_var(--surface-shadow-mid),0_6px_6px_-3px_var(--surface-shadow-mid),0_12px_12px_-6px_var(--surface-shadow-far)]",
};

/**
 * Flush-surface elevation: bg + a directional drop shadow cast toward the
 * inner edge + the single-edge inset rim on that edge. Use for viewport-flush
 * containers (Sheet/Drawer `default` variant) instead of `solidSurface` (whose
 * all-around, downward shadow only suits a free-floating surface). `innerEdge`
 * is the content-facing edge — derive it from the attach side via
 * `INNER_EDGE_FROM_ATTACH_SIDE`.
 */
export function flushSurface(
  level: SurfaceLevel,
  innerEdge: "top" | "bottom" | "left" | "right",
): string {
  return `${SURFACE_BG[level]} ${SURFACE_VAR[level]} ${INNER_EDGE_SHADOW[innerEdge]} ${innerEdgeRim(innerEdge)}`;
}

export interface ElevatedProps extends React.ComponentProps<"div"> {
  level: SurfaceLevel;
  shadowLevel?: SurfaceLevel;
}

function Elevated({ level, shadowLevel, className, ...props }: ElevatedProps) {
  return (
    <div
      data-slot="elevated"
      data-level={level}
      className={cn(surfaceClasses(level, shadowLevel ?? level), className)}
      {...props}
    />
  );
}

export { Elevated };
```

## Usage [#usage]

**Imports:**

```tsx
import {
  Combobox,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxEmpty,
  ComboboxLabel,
} from "@/components/ui/cubby-ui/combobox";
```

**Basic Usage:**

```tsx
<Combobox>
  <ComboboxLabel />
  <ComboboxInput />
  <ComboboxPopup>
    <ComboboxEmpty />
    <ComboboxList>
      <ComboboxItem />
    </ComboboxList>
  </ComboboxPopup>
</Combobox>
```

## Composition [#composition]

```text
Combobox
├── ComboboxLabel
├── ComboboxInput
└── ComboboxPopup
    ├── ComboboxEmpty
    └── ComboboxList
        ├── ComboboxGroup
        │   ├── ComboboxGroupLabel
        │   └── ComboboxItem
        └── ComboboxItem
```

## Examples [#examples]

### Creatable [#creatable]

Let users add an option that isn't in the list from their typed input.

```tsx
// combobox-creatable.tsx
"use client";

import * as React from "react";
import {
  Combobox,
  ComboboxChipInput,
  ComboboxItem,
  ComboboxList,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipRemove,
  ComboboxValue,
  ComboboxPopup,
  ComboboxEmpty,
  ComboboxLabel,
} from "@/components/ui/cubby-ui/combobox";
import { useCreatableCombobox } from "@/hooks/cubby-ui/use-creatable-combobox";
import { Button } from "@/components/ui/cubby-ui/button";
import { Input } from "@/components/ui/cubby-ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/cubby-ui/dialog";

import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
export default function ComboboxCreatable() {
  const [items, setItems] = React.useState<LabelItem[]>(initialLabels);
  const [selectedItems, setSelectedItems] = React.useState<LabelItem[]>([]);

  const {
    itemsWithCreatable,
    comboboxProps,
    dialogProps,
    dialogInputProps,
    onDialogSubmit,
    handleCancel,
  } = useCreatableCombobox({
    items,
    onItemsChange: setItems,
    selectedItems,
    onSelectedItemsChange: setSelectedItems,
  });

  return (
    <>
      <Combobox items={itemsWithCreatable} multiple {...comboboxProps}>
        <div className="flex w-full max-w-xs flex-col gap-1">
          <ComboboxLabel>Labels</ComboboxLabel>
          <ComboboxChips>
            <ComboboxValue>
              {(value: LabelItem[]) => (
                <>
                  {value.map((label) => (
                    <ComboboxChip key={label.id} aria-label={label.value}>
                      {label.value}
                      <ComboboxChipRemove aria-label="Remove">
                        <HugeiconsIcon
                          icon={Cancel01Icon}
                          className="h-3 w-3"
                          strokeWidth={2}
                        />
                      </ComboboxChipRemove>
                    </ComboboxChip>
                  ))}
                  <ComboboxChipInput
                    placeholder={value.length > 0 ? "" : "e.g. bug"}
                  />
                </>
              )}
            </ComboboxValue>
          </ComboboxChips>
        </div>

        <ComboboxPopup>
          <ComboboxEmpty>No labels found.</ComboboxEmpty>
          <ComboboxList>
            {(item: LabelItem) =>
              item.creatable ? (
                <ComboboxItem
                  key={item.id}
                  value={item}
                  className="grid-cols-auto"
                >
                  <div className="grid grid-cols-[1rem_1fr] items-center gap-2">
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      className="h-4 w-4"
                      strokeWidth={2}
                    />
                    <span className="break-all">
                      Create &quot;{item.creatable}&quot;
                    </span>
                  </div>
                </ComboboxItem>
              ) : (
                <ComboboxItem key={item.id} value={item}>
                  {item.value}
                </ComboboxItem>
              )
            }
          </ComboboxList>
        </ComboboxPopup>
      </Combobox>

      <Dialog {...dialogProps}>
        <DialogContent showCloseButton={false}>
          <form onSubmit={onDialogSubmit}>
            <DialogHeader>
              <DialogTitle>Create new label</DialogTitle>
              <DialogDescription>Add a new label to select.</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Input
                key={dialogInputProps.defaultValue}
                variant="elevated"
                {...dialogInputProps}
                placeholder="Label name"
                autoFocus
              />
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
              <Button type="submit">Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface LabelItem {
  creatable?: string;
  id: string;
  value: string;
}

const initialLabels: LabelItem[] = [
  { id: "bug", value: "bug" },
  { id: "docs", value: "documentation" },
  { id: "enhancement", value: "enhancement" },
  { id: "help-wanted", value: "help wanted" },
  { id: "good-first-issue", value: "good first issue" },
];
```

### Multiple Selection [#multiple-selection]

Pass `multiple` on `Combobox` to select more than one option.

```tsx
// combobox-multiple.tsx
"use client";

import {
  Combobox,
  ComboboxChipInput,
  ComboboxItem,
  ComboboxList,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipRemove,
  ComboboxValue,
  ComboboxPopup,
  ComboboxEmpty,
  ComboboxLabel,
} from "@/components/ui/cubby-ui/combobox";

import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
export default function ComboboxMultiple() {
  return (
    <Combobox items={langs} multiple>
      <div className="flex w-full max-w-xs flex-col gap-1">
        <ComboboxLabel>Programming languages</ComboboxLabel>
        <ComboboxChips>
          <ComboboxValue>
            {(value: ProgrammingLanguage[]) => (
              <>
                {value.map((language) => (
                  <ComboboxChip key={language.id} aria-label={language.value}>
                    {language.value}
                    <ComboboxChipRemove aria-label="Remove">
                      <HugeiconsIcon
                        icon={Cancel01Icon}
                        className="h-3 w-3"
                        strokeWidth={2}
                      />
                    </ComboboxChipRemove>
                  </ComboboxChip>
                ))}
                <ComboboxChipInput
                  placeholder={value.length > 0 ? "" : "e.g. TypeScript"}
                />
              </>
            )}
          </ComboboxValue>
        </ComboboxChips>
      </div>

      <ComboboxPopup>
        <ComboboxEmpty>No languages found.</ComboboxEmpty>
        <ComboboxList>
          {(language: ProgrammingLanguage) => (
            <ComboboxItem key={language.id} value={language}>
              {language.value}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

interface ProgrammingLanguage {
  id: string;
  value: string;
}

const langs: ProgrammingLanguage[] = [
  { id: "js", value: "JavaScript" },
  { id: "ts", value: "TypeScript" },
  { id: "py", value: "Python" },
  { id: "java", value: "Java" },
  { id: "cpp", value: "C++" },
  { id: "cs", value: "C#" },
  { id: "php", value: "PHP" },
  { id: "ruby", value: "Ruby" },
  { id: "go", value: "Go" },
  { id: "rust", value: "Rust" },
  { id: "swift", value: "Swift" },
];
```

### Input Inside Popup [#input-inside-popup]

Move `ComboboxInput` inside `ComboboxPopup` so the search field sits in the dropdown.

```tsx
// combobox-input-inside-popup.tsx
"use client";

import * as React from "react";
import {
  Combobox,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
  ComboboxPopup,
  ComboboxEmpty,
  ComboboxTriggerLabel,
} from "@/components/ui/cubby-ui/combobox";
import { Button } from "@/components/ui/cubby-ui/button";

import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
export default function ComboboxInputInsidePopup() {
  const [value, setValue] = React.useState<Country | null>(null);

  return (
    <Combobox
      items={countries}
      value={value}
      onValueChange={(value: Country | null) => setValue(value as Country)}
    >
      <div className="flex w-full max-w-2xs flex-col gap-1">
        <ComboboxTriggerLabel>Select country</ComboboxTriggerLabel>
        <ComboboxTrigger
          render={(props) => (
            <Button
              {...props}
              variant="outline"
              className="justify-between font-normal"
              rightSection={
                <HugeiconsIcon
                  icon={ArrowDown01Icon}
                  className="h-4 w-4 opacity-50"
                  strokeWidth={2}
                />
              }
            >
              <ComboboxValue placeholder="Select country" />
            </Button>
          )}
        />
      </div>

      <ComboboxPopup className="flex flex-col p-0" aria-label="Select country">
        <div className="border-border border-b p-2">
          <ComboboxInput
            variant="elevated"
            placeholder="e.g. United Kingdom"
            showTrigger={false}
            showClear={false}
          />
        </div>
        <ComboboxEmpty>No countries found.</ComboboxEmpty>
        <ComboboxList>
          {(country: Country) => (
            <ComboboxItem key={country.code} value={country}>
              {country.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

interface Country {
  code: string;
  value: string;
  continent: string;
  label: string;
}

const countries: Country[] = [
  { code: "af", value: "afghanistan", label: "Afghanistan", continent: "Asia" },
  { code: "al", value: "albania", label: "Albania", continent: "Europe" },
  { code: "dz", value: "algeria", label: "Algeria", continent: "Africa" },
  { code: "ad", value: "andorra", label: "Andorra", continent: "Europe" },
  { code: "ao", value: "angola", label: "Angola", continent: "Africa" },
  {
    code: "ar",
    value: "argentina",
    label: "Argentina",
    continent: "South America",
  },
  { code: "am", value: "armenia", label: "Armenia", continent: "Asia" },
  { code: "au", value: "australia", label: "Australia", continent: "Oceania" },
  { code: "at", value: "austria", label: "Austria", continent: "Europe" },
  { code: "az", value: "azerbaijan", label: "Azerbaijan", continent: "Asia" },
  {
    code: "bs",
    value: "bahamas",
    label: "Bahamas",
    continent: "North America",
  },
  { code: "bh", value: "bahrain", label: "Bahrain", continent: "Asia" },
  { code: "bd", value: "bangladesh", label: "Bangladesh", continent: "Asia" },
  {
    code: "bb",
    value: "barbados",
    label: "Barbados",
    continent: "North America",
  },
  { code: "by", value: "belarus", label: "Belarus", continent: "Europe" },
  { code: "be", value: "belgium", label: "Belgium", continent: "Europe" },
  { code: "bz", value: "belize", label: "Belize", continent: "North America" },
  { code: "bj", value: "benin", label: "Benin", continent: "Africa" },
  { code: "bt", value: "bhutan", label: "Bhutan", continent: "Asia" },
  {
    code: "bo",
    value: "bolivia",
    label: "Bolivia",
    continent: "South America",
  },
  {
    code: "ba",
    value: "bosnia-and-herzegovina",
    label: "Bosnia and Herzegovina",
    continent: "Europe",
  },
  { code: "bw", value: "botswana", label: "Botswana", continent: "Africa" },
  { code: "br", value: "brazil", label: "Brazil", continent: "South America" },
  { code: "bn", value: "brunei", label: "Brunei", continent: "Asia" },
  { code: "bg", value: "bulgaria", label: "Bulgaria", continent: "Europe" },
  {
    code: "bf",
    value: "burkina-faso",
    label: "Burkina Faso",
    continent: "Africa",
  },
  { code: "bi", value: "burundi", label: "Burundi", continent: "Africa" },
  { code: "kh", value: "cambodia", label: "Cambodia", continent: "Asia" },
  { code: "cm", value: "cameroon", label: "Cameroon", continent: "Africa" },
  { code: "ca", value: "canada", label: "Canada", continent: "North America" },
  { code: "cv", value: "cape-verde", label: "Cape Verde", continent: "Africa" },
  {
    code: "cf",
    value: "central-african-republic",
    label: "Central African Republic",
    continent: "Africa",
  },
  { code: "td", value: "chad", label: "Chad", continent: "Africa" },
  { code: "cl", value: "chile", label: "Chile", continent: "South America" },
  { code: "cn", value: "china", label: "China", continent: "Asia" },
  {
    code: "co",
    value: "colombia",
    label: "Colombia",
    continent: "South America",
  },
  { code: "km", value: "comoros", label: "Comoros", continent: "Africa" },
  { code: "cg", value: "congo", label: "Congo", continent: "Africa" },
  {
    code: "cr",
    value: "costa-rica",
    label: "Costa Rica",
    continent: "North America",
  },
  { code: "hr", value: "croatia", label: "Croatia", continent: "Europe" },
  { code: "cu", value: "cuba", label: "Cuba", continent: "North America" },
  { code: "cy", value: "cyprus", label: "Cyprus", continent: "Asia" },
  {
    code: "cz",
    value: "czech-republic",
    label: "Czech Republic",
    continent: "Europe",
  },
  { code: "dk", value: "denmark", label: "Denmark", continent: "Europe" },
  { code: "dj", value: "djibouti", label: "Djibouti", continent: "Africa" },
  {
    code: "dm",
    value: "dominica",
    label: "Dominica",
    continent: "North America",
  },
  {
    code: "do",
    value: "dominican-republic",
    label: "Dominican Republic",
    continent: "North America",
  },
  {
    code: "ec",
    value: "ecuador",
    label: "Ecuador",
    continent: "South America",
  },
  { code: "eg", value: "egypt", label: "Egypt", continent: "Africa" },
  {
    code: "sv",
    value: "el-salvador",
    label: "El Salvador",
    continent: "North America",
  },
  {
    code: "gq",
    value: "equatorial-guinea",
    label: "Equatorial Guinea",
    continent: "Africa",
  },
  { code: "er", value: "eritrea", label: "Eritrea", continent: "Africa" },
  { code: "ee", value: "estonia", label: "Estonia", continent: "Europe" },
  { code: "et", value: "ethiopia", label: "Ethiopia", continent: "Africa" },
  { code: "fj", value: "fiji", label: "Fiji", continent: "Oceania" },
  { code: "fi", value: "finland", label: "Finland", continent: "Europe" },
  { code: "fr", value: "france", label: "France", continent: "Europe" },
  { code: "ga", value: "gabon", label: "Gabon", continent: "Africa" },
  { code: "gm", value: "gambia", label: "Gambia", continent: "Africa" },
  { code: "ge", value: "georgia", label: "Georgia", continent: "Asia" },
  { code: "de", value: "germany", label: "Germany", continent: "Europe" },
  { code: "gh", value: "ghana", label: "Ghana", continent: "Africa" },
  { code: "gr", value: "greece", label: "Greece", continent: "Europe" },
  {
    code: "gd",
    value: "grenada",
    label: "Grenada",
    continent: "North America",
  },
  {
    code: "gt",
    value: "guatemala",
    label: "Guatemala",
    continent: "North America",
  },
  { code: "gn", value: "guinea", label: "Guinea", continent: "Africa" },
  {
    code: "gw",
    value: "guinea-bissau",
    label: "Guinea-Bissau",
    continent: "Africa",
  },
  { code: "gy", value: "guyana", label: "Guyana", continent: "South America" },
  { code: "ht", value: "haiti", label: "Haiti", continent: "North America" },
  {
    code: "hn",
    value: "honduras",
    label: "Honduras",
    continent: "North America",
  },
  { code: "hu", value: "hungary", label: "Hungary", continent: "Europe" },
  { code: "is", value: "iceland", label: "Iceland", continent: "Europe" },
  { code: "in", value: "india", label: "India", continent: "Asia" },
  { code: "id", value: "indonesia", label: "Indonesia", continent: "Asia" },
  { code: "ir", value: "iran", label: "Iran", continent: "Asia" },
  { code: "iq", value: "iraq", label: "Iraq", continent: "Asia" },
  { code: "ie", value: "ireland", label: "Ireland", continent: "Europe" },
  { code: "il", value: "israel", label: "Israel", continent: "Asia" },
  { code: "it", value: "italy", label: "Italy", continent: "Europe" },
  {
    code: "jm",
    value: "jamaica",
    label: "Jamaica",
    continent: "North America",
  },
  { code: "jp", value: "japan", label: "Japan", continent: "Asia" },
  { code: "jo", value: "jordan", label: "Jordan", continent: "Asia" },
  { code: "kz", value: "kazakhstan", label: "Kazakhstan", continent: "Asia" },
  { code: "ke", value: "kenya", label: "Kenya", continent: "Africa" },
  { code: "kw", value: "kuwait", label: "Kuwait", continent: "Asia" },
  { code: "kg", value: "kyrgyzstan", label: "Kyrgyzstan", continent: "Asia" },
  { code: "la", value: "laos", label: "Laos", continent: "Asia" },
  { code: "lv", value: "latvia", label: "Latvia", continent: "Europe" },
  { code: "lb", value: "lebanon", label: "Lebanon", continent: "Asia" },
  { code: "ls", value: "lesotho", label: "Lesotho", continent: "Africa" },
  { code: "lr", value: "liberia", label: "Liberia", continent: "Africa" },
  { code: "ly", value: "libya", label: "Libya", continent: "Africa" },
  {
    code: "li",
    value: "liechtenstein",
    label: "Liechtenstein",
    continent: "Europe",
  },
  { code: "lt", value: "lithuania", label: "Lithuania", continent: "Europe" },
  { code: "lu", value: "luxembourg", label: "Luxembourg", continent: "Europe" },
  { code: "mg", value: "madagascar", label: "Madagascar", continent: "Africa" },
  { code: "mw", value: "malawi", label: "Malawi", continent: "Africa" },
  { code: "my", value: "malaysia", label: "Malaysia", continent: "Asia" },
  { code: "mv", value: "maldives", label: "Maldives", continent: "Asia" },
  { code: "ml", value: "mali", label: "Mali", continent: "Africa" },
  { code: "mt", value: "malta", label: "Malta", continent: "Europe" },
  {
    code: "mh",
    value: "marshall-islands",
    label: "Marshall Islands",
    continent: "Oceania",
  },
  { code: "mr", value: "mauritania", label: "Mauritania", continent: "Africa" },
  { code: "mu", value: "mauritius", label: "Mauritius", continent: "Africa" },
  { code: "mx", value: "mexico", label: "Mexico", continent: "North America" },
  {
    code: "fm",
    value: "micronesia",
    label: "Micronesia",
    continent: "Oceania",
  },
  { code: "md", value: "moldova", label: "Moldova", continent: "Europe" },
  { code: "mc", value: "monaco", label: "Monaco", continent: "Europe" },
  { code: "mn", value: "mongolia", label: "Mongolia", continent: "Asia" },
  { code: "me", value: "montenegro", label: "Montenegro", continent: "Europe" },
  { code: "ma", value: "morocco", label: "Morocco", continent: "Africa" },
  { code: "mz", value: "mozambique", label: "Mozambique", continent: "Africa" },
  { code: "mm", value: "myanmar", label: "Myanmar", continent: "Asia" },
  { code: "na", value: "namibia", label: "Namibia", continent: "Africa" },
  { code: "nr", value: "nauru", label: "Nauru", continent: "Oceania" },
  { code: "np", value: "nepal", label: "Nepal", continent: "Asia" },
  {
    code: "nl",
    value: "netherlands",
    label: "Netherlands",
    continent: "Europe",
  },
  {
    code: "nz",
    value: "new-zealand",
    label: "New Zealand",
    continent: "Oceania",
  },
  {
    code: "ni",
    value: "nicaragua",
    label: "Nicaragua",
    continent: "North America",
  },
  { code: "ne", value: "niger", label: "Niger", continent: "Africa" },
  { code: "ng", value: "nigeria", label: "Nigeria", continent: "Africa" },
  { code: "kp", value: "north-korea", label: "North Korea", continent: "Asia" },
  {
    code: "mk",
    value: "north-macedonia",
    label: "North Macedonia",
    continent: "Europe",
  },
  { code: "no", value: "norway", label: "Norway", continent: "Europe" },
  { code: "om", value: "oman", label: "Oman", continent: "Asia" },
  { code: "pk", value: "pakistan", label: "Pakistan", continent: "Asia" },
  { code: "pw", value: "palau", label: "Palau", continent: "Oceania" },
  { code: "ps", value: "palestine", label: "Palestine", continent: "Asia" },
  { code: "pa", value: "panama", label: "Panama", continent: "North America" },
  {
    code: "pg",
    value: "papua-new-guinea",
    label: "Papua New Guinea",
    continent: "Oceania",
  },
  {
    code: "py",
    value: "paraguay",
    label: "Paraguay",
    continent: "South America",
  },
  { code: "pe", value: "peru", label: "Peru", continent: "South America" },
  { code: "ph", value: "philippines", label: "Philippines", continent: "Asia" },
  { code: "pl", value: "poland", label: "Poland", continent: "Europe" },
  { code: "pt", value: "portugal", label: "Portugal", continent: "Europe" },
  { code: "qa", value: "qatar", label: "Qatar", continent: "Asia" },
  { code: "ro", value: "romania", label: "Romania", continent: "Europe" },
  { code: "ru", value: "russia", label: "Russia", continent: "Europe" },
  { code: "rw", value: "rwanda", label: "Rwanda", continent: "Africa" },
  { code: "ws", value: "samoa", label: "Samoa", continent: "Oceania" },
  { code: "sm", value: "san-marino", label: "San Marino", continent: "Europe" },
  {
    code: "sa",
    value: "saudi-arabia",
    label: "Saudi Arabia",
    continent: "Asia",
  },
  { code: "sn", value: "senegal", label: "Senegal", continent: "Africa" },
  { code: "rs", value: "serbia", label: "Serbia", continent: "Europe" },
  { code: "sc", value: "seychelles", label: "Seychelles", continent: "Africa" },
  {
    code: "sl",
    value: "sierra-leone",
    label: "Sierra Leone",
    continent: "Africa",
  },
  { code: "sg", value: "singapore", label: "Singapore", continent: "Asia" },
  { code: "sk", value: "slovakia", label: "Slovakia", continent: "Europe" },
  { code: "si", value: "slovenia", label: "Slovenia", continent: "Europe" },
  {
    code: "sb",
    value: "solomon-islands",
    label: "Solomon Islands",
    continent: "Oceania",
  },
  { code: "so", value: "somalia", label: "Somalia", continent: "Africa" },
  {
    code: "za",
    value: "south-africa",
    label: "South Africa",
    continent: "Africa",
  },
  { code: "kr", value: "south-korea", label: "South Korea", continent: "Asia" },
  {
    code: "ss",
    value: "south-sudan",
    label: "South Sudan",
    continent: "Africa",
  },
  { code: "es", value: "spain", label: "Spain", continent: "Europe" },
  { code: "lk", value: "sri-lanka", label: "Sri Lanka", continent: "Asia" },
  { code: "sd", value: "sudan", label: "Sudan", continent: "Africa" },
  {
    code: "sr",
    value: "suriname",
    label: "Suriname",
    continent: "South America",
  },
  { code: "se", value: "sweden", label: "Sweden", continent: "Europe" },
  {
    code: "ch",
    value: "switzerland",
    label: "Switzerland",
    continent: "Europe",
  },
  { code: "sy", value: "syria", label: "Syria", continent: "Asia" },
  { code: "tw", value: "taiwan", label: "Taiwan", continent: "Asia" },
  { code: "tj", value: "tajikistan", label: "Tajikistan", continent: "Asia" },
  { code: "tz", value: "tanzania", label: "Tanzania", continent: "Africa" },
  { code: "th", value: "thailand", label: "Thailand", continent: "Asia" },
  { code: "tl", value: "timor-leste", label: "Timor-Leste", continent: "Asia" },
  { code: "tg", value: "togo", label: "Togo", continent: "Africa" },
  { code: "to", value: "tonga", label: "Tonga", continent: "Oceania" },
  {
    code: "tt",
    value: "trinidad-and-tobago",
    label: "Trinidad and Tobago",
    continent: "North America",
  },
  { code: "tn", value: "tunisia", label: "Tunisia", continent: "Africa" },
  { code: "tr", value: "turkey", label: "Turkey", continent: "Asia" },
  {
    code: "tm",
    value: "turkmenistan",
    label: "Turkmenistan",
    continent: "Asia",
  },
  { code: "tv", value: "tuvalu", label: "Tuvalu", continent: "Oceania" },
  { code: "ug", value: "uganda", label: "Uganda", continent: "Africa" },
  { code: "ua", value: "ukraine", label: "Ukraine", continent: "Europe" },
  {
    code: "ae",
    value: "united-arab-emirates",
    label: "United Arab Emirates",
    continent: "Asia",
  },
  {
    code: "gb",
    value: "united-kingdom",
    label: "United Kingdom",
    continent: "Europe",
  },
  {
    code: "us",
    value: "united-states",
    label: "United States",
    continent: "North America",
  },
  {
    code: "uy",
    value: "uruguay",
    label: "Uruguay",
    continent: "South America",
  },
  { code: "uz", value: "uzbekistan", label: "Uzbekistan", continent: "Asia" },
  { code: "vu", value: "vanuatu", label: "Vanuatu", continent: "Oceania" },
  {
    code: "va",
    value: "vatican-city",
    label: "Vatican City",
    continent: "Europe",
  },
  {
    code: "ve",
    value: "venezuela",
    label: "Venezuela",
    continent: "South America",
  },
  { code: "vn", value: "vietnam", label: "Vietnam", continent: "Asia" },
  { code: "ye", value: "yemen", label: "Yemen", continent: "Asia" },
  { code: "zm", value: "zambia", label: "Zambia", continent: "Africa" },
  { code: "zw", value: "zimbabwe", label: "Zimbabwe", continent: "Africa" },
];
```

### Icons and Adornments [#icons-and-adornments]

Pass `start` and `end` to `ComboboxInput` to place content inside the field. Use `start` for a leading search icon and `end` for trailing content like an async loading spinner. The `end` slot sits before the built-in clear and trigger buttons, so the chevron stays at the trailing edge.

```tsx
// combobox-adornments.tsx
"use client";

import * as React from "react";
import {
  Combobox,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxEmpty,
  ComboboxLabel,
} from "@/components/ui/cubby-ui/combobox";
import { useAsyncCombobox } from "@/hooks/cubby-ui/use-async-combobox";

import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon, Loading03Icon } from "@hugeicons/core-free-icons";

export default function ComboboxAdornments() {
  const [value, setValue] = React.useState<City | null>(null);

  const { items, comboboxProps, isPending } = useAsyncCombobox({
    searchFn: searchCities,
    value,
    onValueChange: setValue,
  });

  return (
    <Combobox
      items={items}
      value={value}
      onValueChange={setValue}
      itemToStringLabel={(city) => city?.name ?? ""}
      {...comboboxProps}
    >
      <div className="flex w-full max-w-xs flex-col gap-1">
        <ComboboxLabel>Search cities</ComboboxLabel>
        <ComboboxInput
          placeholder="e.g. Tokyo"
          start={<HugeiconsIcon icon={Search01Icon} strokeWidth={2} />}
          end={
            isPending ? (
              <HugeiconsIcon
                icon={Loading03Icon}
                className="animate-spin"
                strokeWidth={2}
              />
            ) : null
          }
        />
      </div>
      <ComboboxPopup>
        <ComboboxEmpty>No cities found.</ComboboxEmpty>
        <ComboboxList>
          {(city: City) => (
            <ComboboxItem key={city.id} value={city}>
              <span className="font-medium">{city.name}</span>
              <span className="text-muted-foreground ml-1.5 text-xs">
                {city.country}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

interface City {
  id: string;
  name: string;
  country: string;
}

async function searchCities(
  query: string,
  signal: AbortSignal,
): Promise<City[]> {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, Math.random() * 300 + 250);
    signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

  const lowerQuery = query.toLowerCase();
  return cities.filter(
    (city) =>
      city.name.toLowerCase().includes(lowerQuery) ||
      city.country.toLowerCase().includes(lowerQuery),
  );
}

const cities: City[] = [
  { id: "tokyo", name: "Tokyo", country: "Japan" },
  { id: "osaka", name: "Osaka", country: "Japan" },
  { id: "seoul", name: "Seoul", country: "South Korea" },
  { id: "taipei", name: "Taipei", country: "Taiwan" },
  { id: "singapore", name: "Singapore", country: "Singapore" },
  { id: "bangkok", name: "Bangkok", country: "Thailand" },
  { id: "mumbai", name: "Mumbai", country: "India" },
  { id: "berlin", name: "Berlin", country: "Germany" },
  { id: "paris", name: "Paris", country: "France" },
  { id: "madrid", name: "Madrid", country: "Spain" },
  { id: "lisbon", name: "Lisbon", country: "Portugal" },
  { id: "london", name: "London", country: "United Kingdom" },
  { id: "toronto", name: "Toronto", country: "Canada" },
  { id: "chicago", name: "Chicago", country: "United States" },
  { id: "austin", name: "Austin", country: "United States" },
  { id: "mexico-city", name: "Mexico City", country: "Mexico" },
  { id: "sao-paulo", name: "São Paulo", country: "Brazil" },
  { id: "sydney", name: "Sydney", country: "Australia" },
  { id: "cairo", name: "Cairo", country: "Egypt" },
  { id: "nairobi", name: "Nairobi", country: "Kenya" },
];
```

### Async Search [#async-search]

Load options from a remote source by fetching on input changes. The `useAsyncCombobox` hook handles request cancellation, loading states, and keeps the selected value visible while new results stream in.

```tsx
// combobox-async.tsx
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Combobox,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxEmpty,
  ComboboxLabel,
  ComboboxStatus,
} from "@/components/ui/cubby-ui/combobox";
import { useAsyncCombobox } from "@/hooks/cubby-ui/use-async-combobox";

import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon } from "@hugeicons/core-free-icons";
export default function ComboboxAsync() {
  const [value, setValue] = React.useState<Employee | null>(null);

  const { items, comboboxProps, isPending, error, query } = useAsyncCombobox({
    searchFn: searchEmployees,
    value,
    onValueChange: setValue,
  });

  function getStatus() {
    if (error) return error;
    // Loading now lives in the input's end slot; only surface text here when
    // there are no stale results to show, so the popup is never blank.
    if (isPending && items.length === 0) return "Searching...";
    if (query === "") {
      return value ? null : "Start typing to search employees...";
    }
    if (!isPending && items.length === 0) {
      return `No matches for "${query}".`;
    }
    return null;
  }

  function getEmptyMessage() {
    if (query === "" || isPending || items.length > 0 || error) {
      return null;
    }
    return "Try a different search term.";
  }

  return (
    <Combobox
      items={items}
      value={value}
      onValueChange={setValue}
      itemToStringLabel={(employee) => employee?.name ?? ""}
      {...comboboxProps}
    >
      <div className="flex w-full max-w-xs flex-col gap-1">
        <ComboboxLabel>Search employees</ComboboxLabel>
        <ComboboxInput
          placeholder="e.g. Sarah"
          aria-busy={isPending}
          end={
            isPending ? (
              <HugeiconsIcon
                icon={Loading03Icon}
                className="animate-spin"
                strokeWidth={2}
              />
            ) : null
          }
        />
      </div>
      <ComboboxPopup>
        <ComboboxStatus>{getStatus()}</ComboboxStatus>
        <ComboboxEmpty>{getEmptyMessage()}</ComboboxEmpty>
        {/* Dim stale results while the next query resolves. Gate on items so the
            first search (no prior results) doesn't fade in from dim. */}
        <ComboboxList
          className={cn(
            "transition-opacity duration-150",
            isPending && items.length > 0 && "opacity-50",
          )}
        >
          {(employee: Employee) => (
            <ComboboxItem key={employee.id} value={employee}>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{employee.name}</span>
                <span className="text-muted-foreground text-xs">
                  {employee.department} &middot; {employee.email}
                </span>
              </div>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

interface Employee {
  id: string;
  name: string;
  department: string;
  email: string;
}

async function searchEmployees(
  query: string,
  signal: AbortSignal,
): Promise<Employee[]> {
  // Simulate network delay
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, Math.random() * 300 + 200);
    signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

  // Small chance of error for demo
  if (Math.random() < 0.02 || query === "error") {
    throw new Error("Failed to search. Please try again.");
  }

  const lowerQuery = query.toLowerCase();
  return employees.filter(
    (employee) =>
      employee.name.toLowerCase().includes(lowerQuery) ||
      employee.department.toLowerCase().includes(lowerQuery) ||
      employee.email.toLowerCase().includes(lowerQuery),
  );
}

const employees: Employee[] = [
  {
    id: "sarah-chen",
    name: "Sarah Chen",
    department: "Engineering",
    email: "sarah.chen@company.com",
  },
  {
    id: "marcus-johnson",
    name: "Marcus Johnson",
    department: "Design",
    email: "marcus.johnson@company.com",
  },
  {
    id: "elena-rodriguez",
    name: "Elena Rodriguez",
    department: "Marketing",
    email: "elena.rodriguez@company.com",
  },
  {
    id: "david-kim",
    name: "David Kim",
    department: "Engineering",
    email: "david.kim@company.com",
  },
  {
    id: "priya-patel",
    name: "Priya Patel",
    department: "Product",
    email: "priya.patel@company.com",
  },
  {
    id: "james-wilson",
    name: "James Wilson",
    department: "Sales",
    email: "james.wilson@company.com",
  },
  {
    id: "aisha-mohamed",
    name: "Aisha Mohamed",
    department: "Engineering",
    email: "aisha.mohamed@company.com",
  },
  {
    id: "michael-brown",
    name: "Michael Brown",
    department: "Finance",
    email: "michael.brown@company.com",
  },
  {
    id: "lisa-wang",
    name: "Lisa Wang",
    department: "Design",
    email: "lisa.wang@company.com",
  },
  {
    id: "carlos-garcia",
    name: "Carlos Garcia",
    department: "Support",
    email: "carlos.garcia@company.com",
  },
  {
    id: "emma-taylor",
    name: "Emma Taylor",
    department: "HR",
    email: "emma.taylor@company.com",
  },
  {
    id: "raj-sharma",
    name: "Raj Sharma",
    department: "Engineering",
    email: "raj.sharma@company.com",
  },
  {
    id: "olivia-martin",
    name: "Olivia Martin",
    department: "Legal",
    email: "olivia.martin@company.com",
  },
  {
    id: "tom-anderson",
    name: "Tom Anderson",
    department: "Product",
    email: "tom.anderson@company.com",
  },
  {
    id: "nina-petrov",
    name: "Nina Petrov",
    department: "Marketing",
    email: "nina.petrov@company.com",
  },
  {
    id: "alex-thompson",
    name: "Alex Thompson",
    department: "Engineering",
    email: "alex.thompson@company.com",
  },
  {
    id: "maya-lee",
    name: "Maya Lee",
    department: "Design",
    email: "maya.lee@company.com",
  },
  {
    id: "ben-clark",
    name: "Ben Clark",
    department: "Sales",
    email: "ben.clark@company.com",
  },
  {
    id: "zoe-adams",
    name: "Zoe Adams",
    department: "Finance",
    email: "zoe.adams@company.com",
  },
  {
    id: "kevin-nguyen",
    name: "Kevin Nguyen",
    department: "Support",
    email: "kevin.nguyen@company.com",
  },
];
```

### Async Search (Multiple) [#async-search-multiple]

Combine async search with `multiple`; selected items stay visible in the dropdown while new matches load.

```tsx
// combobox-async-multiple.tsx
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Combobox,
  ComboboxChipInput,
  ComboboxItem,
  ComboboxList,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipRemove,
  ComboboxValue,
  ComboboxPopup,
  ComboboxEmpty,
  ComboboxLabel,
  ComboboxStatus,
} from "@/components/ui/cubby-ui/combobox";
import { useAsyncCombobox } from "@/hooks/cubby-ui/use-async-combobox";

import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Loading03Icon } from "@hugeicons/core-free-icons";
export default function ComboboxAsyncMultiple() {
  const [value, setValue] = React.useState<Employee[]>([]);

  const { items, comboboxProps, isPending, error, query } = useAsyncCombobox({
    searchFn: searchEmployees,
    multiple: true,
    value,
    onValueChange: setValue,
  });

  function getStatus() {
    if (error) return error;
    // Loading now lives at the trailing edge of the chips row; only surface text
    // here when there are no stale results to show, so the popup is never blank.
    if (isPending && items.length === 0) return "Searching...";
    if (query === "") {
      return value.length === 0 ? "Start typing to search employees..." : null;
    }
    if (!isPending && items.length === 0) {
      return `No matches for "${query}".`;
    }
    return null;
  }

  function getEmptyMessage() {
    if (query === "" || isPending || items.length > 0 || error) {
      return null;
    }
    return "Try a different search term.";
  }

  return (
    <Combobox
      items={items}
      value={value}
      onValueChange={setValue}
      multiple
      {...comboboxProps}
    >
      <div className="flex w-full max-w-xs flex-col gap-1">
        <ComboboxLabel>Assign team members</ComboboxLabel>
        <ComboboxChips>
          <ComboboxValue>
            {(selectedEmployees: Employee[]) => (
              <>
                {selectedEmployees.map((employee) => (
                  <ComboboxChip key={employee.id} aria-label={employee.name}>
                    {employee.name}
                    <ComboboxChipRemove aria-label="Remove">
                      <HugeiconsIcon
                        icon={Cancel01Icon}
                        className="h-3 w-3"
                        strokeWidth={2}
                      />
                    </ComboboxChipRemove>
                  </ComboboxChip>
                ))}
                <ComboboxChipInput
                  placeholder={selectedEmployees.length > 0 ? "" : "e.g. Sarah"}
                  aria-busy={isPending}
                />
                {isPending && (
                  <span
                    aria-hidden="true"
                    className="text-muted-foreground flex shrink-0 items-center self-center ps-1 pe-0.5"
                  >
                    <HugeiconsIcon
                      icon={Loading03Icon}
                      className="size-4 animate-spin"
                      strokeWidth={2}
                    />
                  </span>
                )}
              </>
            )}
          </ComboboxValue>
        </ComboboxChips>
      </div>

      <ComboboxPopup>
        <ComboboxStatus>{getStatus()}</ComboboxStatus>
        <ComboboxEmpty>{getEmptyMessage()}</ComboboxEmpty>
        {/* Dim stale results while the next query resolves. Gate on items so the
            first search (no prior results) doesn't fade in from dim. */}
        <ComboboxList
          className={cn(
            "transition-opacity duration-150",
            isPending && items.length > 0 && "opacity-50",
          )}
        >
          {(employee: Employee) => (
            <ComboboxItem key={employee.id} value={employee}>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{employee.name}</span>
                <span className="text-muted-foreground text-xs">
                  {employee.department} &middot; {employee.email}
                </span>
              </div>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

interface Employee {
  id: string;
  name: string;
  department: string;
  email: string;
}

async function searchEmployees(
  query: string,
  signal: AbortSignal,
): Promise<Employee[]> {
  // Simulate network delay
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, Math.random() * 300 + 200);
    signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

  // Small chance of error for demo
  if (Math.random() < 0.02 || query === "error") {
    throw new Error("Failed to search. Please try again.");
  }

  const lowerQuery = query.toLowerCase();
  return employees.filter(
    (employee) =>
      employee.name.toLowerCase().includes(lowerQuery) ||
      employee.department.toLowerCase().includes(lowerQuery) ||
      employee.email.toLowerCase().includes(lowerQuery),
  );
}

const employees: Employee[] = [
  {
    id: "sarah-chen",
    name: "Sarah Chen",
    department: "Engineering",
    email: "sarah.chen@company.com",
  },
  {
    id: "marcus-johnson",
    name: "Marcus Johnson",
    department: "Design",
    email: "marcus.johnson@company.com",
  },
  {
    id: "elena-rodriguez",
    name: "Elena Rodriguez",
    department: "Marketing",
    email: "elena.rodriguez@company.com",
  },
  {
    id: "david-kim",
    name: "David Kim",
    department: "Engineering",
    email: "david.kim@company.com",
  },
  {
    id: "priya-patel",
    name: "Priya Patel",
    department: "Product",
    email: "priya.patel@company.com",
  },
  {
    id: "james-wilson",
    name: "James Wilson",
    department: "Sales",
    email: "james.wilson@company.com",
  },
  {
    id: "aisha-mohamed",
    name: "Aisha Mohamed",
    department: "Engineering",
    email: "aisha.mohamed@company.com",
  },
  {
    id: "michael-brown",
    name: "Michael Brown",
    department: "Finance",
    email: "michael.brown@company.com",
  },
  {
    id: "lisa-wang",
    name: "Lisa Wang",
    department: "Design",
    email: "lisa.wang@company.com",
  },
  {
    id: "carlos-garcia",
    name: "Carlos Garcia",
    department: "Support",
    email: "carlos.garcia@company.com",
  },
  {
    id: "emma-taylor",
    name: "Emma Taylor",
    department: "HR",
    email: "emma.taylor@company.com",
  },
  {
    id: "raj-sharma",
    name: "Raj Sharma",
    department: "Engineering",
    email: "raj.sharma@company.com",
  },
  {
    id: "olivia-martin",
    name: "Olivia Martin",
    department: "Legal",
    email: "olivia.martin@company.com",
  },
  {
    id: "tom-anderson",
    name: "Tom Anderson",
    department: "Product",
    email: "tom.anderson@company.com",
  },
  {
    id: "nina-petrov",
    name: "Nina Petrov",
    department: "Marketing",
    email: "nina.petrov@company.com",
  },
  {
    id: "alex-thompson",
    name: "Alex Thompson",
    department: "Engineering",
    email: "alex.thompson@company.com",
  },
  {
    id: "maya-lee",
    name: "Maya Lee",
    department: "Design",
    email: "maya.lee@company.com",
  },
  {
    id: "ben-clark",
    name: "Ben Clark",
    department: "Sales",
    email: "ben.clark@company.com",
  },
  {
    id: "zoe-adams",
    name: "Zoe Adams",
    department: "Finance",
    email: "zoe.adams@company.com",
  },
  {
    id: "kevin-nguyen",
    name: "Kevin Nguyen",
    department: "Support",
    email: "kevin.nguyen@company.com",
  },
];
```

### Grouped [#grouped]

Wrap items in `ComboboxGroup` with a `ComboboxGroupLabel` for sticky section headers.

```tsx
// combobox-grouped.tsx
"use client";

import {
  Combobox,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxEmpty,
  ComboboxLabel,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxCollection,
  ComboboxSeparator,
} from "@/components/ui/cubby-ui/combobox";
import React from "react";

export default function ComboboxGrouped() {
  return (
    <Combobox items={groupedProduce}>
      <div className="flex w-full max-w-3xs flex-col gap-1">
        <ComboboxLabel>Select produce</ComboboxLabel>
        <ComboboxInput placeholder="e.g. Mango" />
      </div>
      <ComboboxPopup>
        <ComboboxEmpty>No produce found.</ComboboxEmpty>
        <ComboboxList fadeEdges={"bottom"}>
          {(group: ProduceGroup) => (
            <React.Fragment key={group.value}>
              <ComboboxGroup key={group.value} items={group.items}>
                <ComboboxGroupLabel className="sticky top-0 z-[1]">
                  {group.value}
                </ComboboxGroupLabel>
                <ComboboxCollection>
                  {(item: Produce) => (
                    <ComboboxItem key={item.id} value={item}>
                      {item.label}
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
              {group.value !== "Vegetables" && <ComboboxSeparator />}
            </React.Fragment>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

interface Produce {
  id: string;
  label: string;
  group: "Fruits" | "Vegetables";
}

interface ProduceGroup {
  value: string;
  items: Produce[];
}

const produceData: Produce[] = [
  { id: "fruit-apple", label: "Apple", group: "Fruits" },
  { id: "fruit-banana", label: "Banana", group: "Fruits" },
  { id: "fruit-mango", label: "Mango", group: "Fruits" },
  { id: "fruit-kiwi", label: "Kiwi", group: "Fruits" },
  { id: "fruit-grape", label: "Grape", group: "Fruits" },
  { id: "fruit-orange", label: "Orange", group: "Fruits" },
  { id: "fruit-strawberry", label: "Strawberry", group: "Fruits" },
  { id: "fruit-watermelon", label: "Watermelon", group: "Fruits" },
  { id: "veg-broccoli", label: "Broccoli", group: "Vegetables" },
  { id: "veg-carrot", label: "Carrot", group: "Vegetables" },
  { id: "veg-cauliflower", label: "Cauliflower", group: "Vegetables" },
  { id: "veg-cucumber", label: "Cucumber", group: "Vegetables" },
  { id: "veg-kale", label: "Kale", group: "Vegetables" },
  { id: "veg-pepper", label: "Bell pepper", group: "Vegetables" },
  { id: "veg-spinach", label: "Spinach", group: "Vegetables" },
  { id: "veg-zucchini", label: "Zucchini", group: "Vegetables" },
];

function groupProduce(items: Produce[]): ProduceGroup[] {
  const groups: Record<string, Produce[]> = {};
  items.forEach((item) => {
    (groups[item.group] ??= []).push(item);
  });
  const order = ["Fruits", "Vegetables"];
  return order.map((value) => ({ value, items: groups[value] ?? [] }));
}

const groupedProduce: ProduceGroup[] = groupProduce(produceData);
```

### Virtualized [#virtualized]

Use `ComboboxVirtualizedList` for large lists (100+ items); it only renders items in the viewport, dramatically reducing DOM nodes.

```tsx
// combobox-virtualized.tsx
"use client";

import * as React from "react";
import {
  Combobox,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxPopup,
  ComboboxVirtualizedList,
  useComboboxFilteredItems,
} from "@/components/ui/cubby-ui/combobox";
import {
  useListVirtualizer,
  useHighlightHandler,
  type ListVirtualizerInstance,
} from "@/registry/default/hooks/use-list-virtualizer";

interface City {
  id: string;
  name: string;
}

const allCities: City[] = Array.from({ length: 1000 }, (_, i) => ({
  id: `city-${i}`,
  name: `City ${String(i + 1).padStart(4, "0")}`,
}));

const getItemLabel = (item: City) => item.name;

export default function ComboboxVirtualized() {
  const virtualizerRef = React.useRef<ListVirtualizerInstance>(null);
  const onItemHighlighted = useHighlightHandler(virtualizerRef);

  return (
    <Combobox
      items={allCities}
      virtualized
      itemToStringLabel={getItemLabel}
      itemToStringValue={getItemLabel}
      onItemHighlighted={onItemHighlighted}
    >
      <div className="flex w-full max-w-3xs flex-col gap-1">
        <ComboboxLabel>Search 1,000 cities</ComboboxLabel>
        <ComboboxInput placeholder="e.g. City 0001" />
      </div>
      <ComboboxPopup>
        <VirtualizedListContent virtualizerRef={virtualizerRef} />
      </ComboboxPopup>
    </Combobox>
  );
}

function VirtualizedListContent({
  virtualizerRef,
}: {
  virtualizerRef: React.RefObject<ListVirtualizerInstance | null>;
}) {
  const filteredItems = useComboboxFilteredItems<City>();

  const {
    scrollRef,
    measureRef,
    totalSize,
    virtualItems,
    getItem,
    getItemStyle,
    getItemProps,
  } = useListVirtualizer({
    items: allCities,
    filteredItems,
    estimateSize: 40,
    paddingStart: 4,
    paddingEnd: 4,
    virtualizerRef,
  });

  return (
    <ComboboxVirtualizedList
      scrollRef={scrollRef}
      totalSize={totalSize}
      emptyMessage="No cities found."
      fadeEdges="y"
      nativeScroll
    >
      {virtualItems.map((virtualItem) => {
        const item = getItem(virtualItem);
        if (!item) return null;

        return (
          <ComboboxItem
            key={virtualItem.key}
            ref={measureRef}
            value={item}
            style={getItemStyle(virtualItem)}
            className="mt-0! mb-0!"
            {...getItemProps(virtualItem)}
          >
            {item.name}
          </ComboboxItem>
        );
      })}
    </ComboboxVirtualizedList>
  );
}
```

**Key concepts:**

1. **Use `useListVirtualizer` hook** - Handles scroll positioning, keyboard navigation, and item measurement. See [useListVirtualizer docs](/docs/hooks/use-list-virtualizer) for full API reference.
2. **Use `useComboboxFilteredItems()` inside Root** - Call `useComboboxFilteredItems()` in a child component of `Combobox` to get internally filtered items without manual filtering boilerplate.
3. **Replace `ComboboxList` with `ComboboxVirtualizedList`** - Accepts `scrollRef` and `totalSize` from the hook.
4. **Pass `virtualized` and `items` on Root** - Enables virtualized mode with your full item list.
5. **Use `useHighlightHandler`** - Pass a `virtualizerRef` to the child and use `useHighlightHandler(virtualizerRef)` on Root so keyboard navigation scrolls to the highlighted item.
6. **Override item margins** - Pass `className="mt-0! mb-0!"` to `ComboboxItem` since virtualized items are absolutely positioned and the virtualizer handles padding.

### Elevated Variant [#elevated-variant]

Use `variant="elevated"` on `ComboboxInput` for a Card, Dialog, or popover surface, where the opaque `default` input would collapse into its parent. See the [Surfaces](/docs/getting-started/surfaces) docs.

```tsx
// combobox-elevated.tsx
"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/cubby-ui/card";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxPopup,
} from "@/components/ui/cubby-ui/combobox";

export default function ComboboxElevated() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>On a Card surface</CardTitle>
        <CardDescription>
          Use <code>variant=&quot;elevated&quot;</code> on{" "}
          <code>ComboboxInput</code> when the combobox sits inside a Card,
          Dialog, or popover.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Combobox items={fruits}>
          <div className="flex flex-col gap-1">
            <ComboboxLabel>Default</ComboboxLabel>
            <ComboboxInput placeholder="Collapses into the card" />
          </div>
          <ComboboxPopup>
            <ComboboxEmpty>No fruits found.</ComboboxEmpty>
            <ComboboxList>
              {(item: string, index: number) => (
                <ComboboxItem key={index} value={item}>
                  {item}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxPopup>
        </Combobox>

        <Combobox items={fruits}>
          <div className="flex flex-col gap-1">
            <ComboboxLabel>Elevated</ComboboxLabel>
            <ComboboxInput
              variant="elevated"
              placeholder="Reads against the substrate"
            />
          </div>
          <ComboboxPopup>
            <ComboboxEmpty>No fruits found.</ComboboxEmpty>
            <ComboboxList>
              {(item: string, index: number) => (
                <ComboboxItem key={index} value={item}>
                  {item}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxPopup>
        </Combobox>
      </CardContent>
    </Card>
  );
}

const fruits = [
  "Apple",
  "Banana",
  "Orange",
  "Pineapple",
  "Grape",
  "Mango",
  "Strawberry",
];
```

| Value      | Description                                                     |
| ---------- | --------------------------------------------------------------- |
| `default`  | Opaque `bg-input`, for standard page backgrounds.               |
| `elevated` | Translucent `bg-input-elevated`, for Card, Dialog, or popovers. |

### Form Integration [#form-integration]

Use [Field](/docs/components/field) with `FieldLabel` for labeling. See the [Forms guide](/docs/getting-started/forms) for more patterns.

```tsx
// combobox-field.tsx
"use client";

import { Button } from "@/components/ui/cubby-ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from "@/components/ui/cubby-ui/combobox";
import { Field, FieldError, FieldLabel } from "@/components/ui/cubby-ui/field";
import { Form } from "@/components/ui/cubby-ui/form";

const regions = [
  "us-east-1",
  "us-west-2",
  "eu-central-1",
  "eu-west-1",
  "ap-southeast-1",
  "ap-northeast-1",
];

export default function ComboboxField() {
  return (
    <Form
      className="w-full max-w-3xs space-y-4"
      onFormSubmit={(values) => {
        alert(JSON.stringify(values, null, 2));
      }}
    >
      <Field name="region">
        <Combobox items={regions} required>
          <FieldLabel>Region</FieldLabel>
          <ComboboxInput placeholder="Search regions..." />
          <ComboboxPopup>
            <ComboboxEmpty>No regions found.</ComboboxEmpty>
            <ComboboxList>
              {(region: string) => (
                <ComboboxItem key={region} value={region}>
                  {region}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxPopup>
        </Combobox>
        <FieldError />
      </Field>
      <Button type="submit" variant="neutral">
        Submit
      </Button>
    </Form>
  );
}
```

## API Reference [#api-reference]

The Combobox component is built on top of [Base UI's Combobox](https://base-ui.com/react/components/combobox). All Base UI props are supported. The documentation below only covers custom props and modified defaults specific to our implementation.

For the complete Base UI API, see the [Base UI Combobox documentation](https://base-ui.com/react/components/combobox).

### Props [#props]

#### ComboboxInput [#comboboxinput]

Text input with built-in trigger and clear buttons. Wraps Base UI's `Combobox.Input` inside a `Combobox.InputGroup`.

- **showTrigger** (type: `boolean`) - Default: `true`
  Show a chevron trigger button to open the popup.
- **showClear** (type: `boolean`) - Default: `true`
  Show a clear button to reset the input value. Only visible when the input has a value.
- **variant** (type: `"default" | "elevated"`) - Default: `"default"`
  Surface appearance of the input. `default` uses opaque `bg-input`. `elevated` uses translucent `bg-input-elevated` for use inside Card, Dialog, or popover surfaces. See the [Surfaces](/docs/getting-started/surfaces) docs.
- **start** (type: `node`, full: `ReactNode`)
  Content pinned to the leading edge of the field, such as a search icon. Bare SVGs default to `size-4` and inherit the muted foreground color.
- **end** (type: `node`, full: `ReactNode`)
  Content pinned to the trailing edge, before the clear and trigger buttons. Useful for an async loading spinner.
- **inputClassName** (type: `string`)
  Class applied to the inner `<input>` element. `className` styles the field wrapper that carries the border, background, and focus ring.

#### ComboboxTriggerLabel [#comboboxtriggerlabel]

Accessible label for the input-inside-popup pattern, where the trigger is the form control. Wraps Base UI's `Combobox.Label`. Renders a `<div>`; clicking it focuses the trigger without opening the popup.

For the standard combobox pattern (input outside popup), use `ComboboxLabel` which renders a native `<label>` associated with the input.

#### ComboboxPopup [#comboboxpopup]

Dropdown container for the option list with positioning. Composes Base UI's `Combobox.Positioner` and `Combobox.Popup`. Props are forwarded to `Combobox.Popup`.

- **sideOffset** (type: `number`) - Default: `6`
  Distance in pixels between the popup and the anchor element. Convenience prop that passes through to the internal Positioner component. Type is inferred from Base UI's Positioner component.
- **backdrop** (type: `boolean`) - Default: `false`
  Show a backdrop overlay behind the popup. Custom prop not available in Base UI.
- **level** (type: `1 | 2 | 3 | 4 | 5 | 6 | 7 | 8`) - Default: `3`
  Surface elevation level for the popup. See the [Surfaces](/docs/getting-started/surfaces) docs. Uses `elevatedSurface` (rim on `::after`) so sticky group labels stay below the rim edge.
- **shadowLevel** (type: `1 | 2 | 3 | 4 | 5 | 6 | 7 | 8`) - Default: `3`
  Shadow weight. Controls drop-shadow intensity independently of substrate color.

#### ComboboxList [#comboboxlist]

Scrollable list of selectable options. Wraps Base UI's `Combobox.Listbox`.

- **nativeScroll** (type: `boolean`) - Default: `false`
  Use native browser scrolling instead of the custom ScrollArea component. Useful for custom layouts where you need more control over scroll behavior, or when nesting the list inside your own scroll container.
- **fadeEdges** (type: `boolean | 'top' | 'bottom' | 'left' | 'right' | 'x' | 'y' | FadeEdge[]`) - Default: `true`
  Controls the fade effect on scroll edges. See [ScrollArea](/docs/components/scroll-area#custom-props) for all options.
- **scrollbarGutter** (type: `boolean`) - Default: `false`
  Reserves space for the scrollbar when content overflows, preventing layout shift.
- **persistScrollbar** (type: `boolean`) - Default: `false`
  Always show the scrollbar instead of fading it in on hover or scroll.
- **hideScrollbar** (type: `boolean`) - Default: `false`
  Hides the scrollbar while keeping scroll functionality.

#### ComboboxVirtualizedList [#comboboxvirtualizedlist]

Virtualized scrollable container for large lists. Use with `useListVirtualizer` hook for optimal performance with 100+ items.

- **scrollRef**
  void">
  Ref callback from `useListVirtualizer` for the scroll container.
- **totalSize** (type: `number`)
  Total height of all virtual items in pixels. Provided by `useListVirtualizer`.
- **emptyMessage** (type: `node`, full: `ReactNode`) - Default: `"No results found."`
  Message shown when no results are found.
- **fadeEdges** (type: `boolean | 'x' | 'y' | FadeEdge[]`) - Default: `"y"`
  Controls the fade effect on scroll edges.
- **nativeScroll** (type: `boolean`) - Default: `false`
  Use native browser scrolling instead of custom scrollbars. Recommended for
  best virtualization performance.

### Hooks [#hooks]

#### useComboboxFilteredItems [#usecomboboxfiltereditems]

```ts
function useComboboxFilteredItems<T>(): T[];
```

Returns the internally filtered items from the Combobox Root. Must be called inside `Combobox` (Root). Simplifies virtualized implementations by eliminating manual query state, `useDeferredValue`, `useFilter()`, and `useMemo` filtering.

```tsx
import { useComboboxFilteredItems } from "@/registry/default/combobox/combobox";

function VirtualizedListContent() {
  // Must be called inside Combobox root
  const filteredItems = useComboboxFilteredItems<MyItem>();

  const virtualizer = useListVirtualizer({
    items: allItems,
    filteredItems,
  });
  // ...
}
```
