"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  Copy01Icon,
  ArrowUpDownIcon,
  Download01Icon,
  ArrowUp01Icon,
  Album02Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/cubby-ui/button";
import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/cubby-ui/collapsible";
import { Sheet, SheetContent } from "@/components/ui/cubby-ui/sheet";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/cubby-ui/tooltip";
import { useBundleActions, useSelectedSkills } from "@/lib/bundle-selection";
import { compareHref } from "@/lib/compare";
import { generateAllCommandsText } from "@/lib/install-commands";
import { useWellKnownIndexes } from "@/hooks/use-well-known-indexes";
import {
  SaveBundleDialog,
  createSaveBundleDialogHandle,
} from "@/components/save-bundle-dialog";
import { toast } from "@/components/ui/cubby-ui/toast/toast";
import { cn } from "@/lib/utils";

const saveBundleDialogHandle = createSaveBundleDialogHandle();

export function BundleBar() {
  const selectedSkills = useSelectedSkills();
  const { clearAll, removeSkill, replaceSelection } = useBundleActions();
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // A selection can hold well-known skills, whose command depends on what
  // their domain publishes. Without this the builder falls back to its empty
  // default and writes nothing for them.
  const { indexes: wellKnown, pending: wellKnownPending } =
    useWellKnownIndexes(selectedSkills);

  // Hold the sheet closed until two painted frames after mount. On reload
  // with a stored selection, the open would otherwise land inside the brief
  // window where next-themes' disableTransitionOnChange globally suppresses
  // transitions while applying the theme class at hydration — the enter
  // slide gets eaten and the bar pops in. Two rAFs clear both the hydration
  // commit and the theme snippet removal, so the open always animates.
  const [enterReady, setEnterReady] = useState(false);
  useEffect(() => {
    let second: number;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setEnterReady(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);

  const count = selectedSkills.length;
  const visible = enterReady && count > 0;
  const isOpen = expanded && visible;
  const canCompare = count >= 2 && count <= 3;

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setExpanded(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  // Next.js cacheComponents wraps the app in React Activity, which preserves
  // this component's state across client-side navigation. Base UI's Collapsible
  // measures its content height via ResizeObserver, which goes stale while the
  // component is dormant. On restore, a preserved `expanded={true}` leaves the
  // chevron pointing up while the tray is visually collapsed (stale height = 0).
  // Force `expanded` back to false on every mount/restore so React state and
  // Base UI state start aligned; the next open triggers a fresh measurement.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpanded(false);
  }, []);

  async function handleCopy() {
    const text = generateAllCommandsText(selectedSkills, wellKnown);
    // Nothing in this selection has a command. Say so instead of flipping the
    // button to "Copied!" over an empty clipboard.
    if (text === "") {
      toast({
        title: "No install command",
        description:
          "These skills' sources don't publish a skills index the CLI can read.",
      });
      return;
    }
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Clearing is destructive (a curated selection can be dozens of skills) and
  // the bar offers no confirmation step — so it's undoable instead. The toast
  // restores the exact snapshot taken before the clear.
  function handleClearAll() {
    const cleared = selectedSkills;
    clearAll();
    const id = toast({
      title: `Cleared ${cleared.length} skill${cleared.length !== 1 ? "s" : ""}`,
      action: {
        label: "Undo",
        onClick: () => {
          replaceSelection(cleared);
          if (id) toast.dismiss(id);
        },
      },
    });
  }

  // Signed out too: the dialog saves to this browser instead of the account
  // (lib/local-bundles.ts), so saving never starts with a sign-in wall.
  function handleSave() {
    saveBundleDialogHandle.open(null);
  }

  return (
    <>
      <Sheet
        open={visible}
        modal={false}
        // `open` is controlled by selection count, so Base UI's own dismissal
        // (Escape) can't actually close the sheet — but it still swallows the
        // Escape keydown before the window listener below sees it when focus
        // is inside the popup. Route that close request to the tray collapse
        // instead, which is what Escape should mean for a status bar.
        onOpenChange={(open) => {
          if (!open) setExpanded(false);
        }}
      >
        <SheetContent
          side="bottom"
          variant="default"
          showCloseButton={false}
          // SiteFooter pads itself while a marked bar is open, so its last
          // row can scroll clear of this one (see site-footer.tsx).
          data-floating-bar=""
          // A non-modal status surface must never take focus: stealing it on
          // open breaks Space-Space-Space row selection (the sheet mounts on
          // the first selection) and on reload-with-stored-selection it would
          // yank focus before the user has done anything. Same on close —
          // leave focus where the user has it.
          initialFocus={false}
          finalFocus={false}
          className={cn(
            "flex flex-col overflow-hidden",
            // Mobile: the `default` (flush) variant already provides a
            // full-width bottom drawer with the directional (upward) surface
            // shadow + top inner-edge rim — no overrides needed.
            // sm+: lift into a centered, rounded floating pill with the
            // all-around solidSurface shadow (4-edge rim). The sm:dark: shadow
            // override is needed to outrank the flush variant's dark: shadow.
            "sm:inset-x-auto sm:right-auto sm:bottom-4 sm:left-1/2 sm:w-auto sm:max-w-[min(640px,calc(100vw-2rem))] sm:-translate-x-1/2 sm:rounded-2xl sm:shadow-[var(--surface-shadow-5),var(--surface-rim-5)] sm:after:shadow-none sm:data-ending-style:translate-y-[calc(100%+1rem)] sm:data-starting-style:translate-y-[calc(100%+1rem)] sm:dark:shadow-[var(--surface-shadow-5),var(--surface-rim-5)]",
            // @starting-style mirror of the enter transforms: Base UI's
            // data-starting-style only animates opens it orchestrates between
            // painted frames — when the bar mounts already-open (selection
            // loading from localStorage right after hydration), there is no
            // prior frame and it pops in. @starting-style animates the
            // element's *insertion* itself, so that case slides in too.
            //
            // Keep these as `translate-y-*`, do NOT rewrite them as a literal
            // `[translate:...]` the way crossfade.tsx does. That file has no
            // horizontal transform, so a literal is equivalent there. Here
            // `sm:-translate-x-1/2` above sets `--tw-translate-x`, and the two
            // axes compose through the shared vars: a literal y would drop the
            // centering for the starting frame and the bar would slide up from
            // half its width off-centre. Hardcoding `-50%` into the literal
            // would work and would silently disagree the day the centering
            // changes.
            "starting:translate-y-full sm:starting:translate-y-[calc(100%+1rem)]",
          )}
        >
          <Collapsible open={isOpen}>
            <CollapsibleContent
              id="bundle-tray"
              className="ease-[cubic-bezier(.32,.72,0,1)]!"
            >
              <ul className="max-h-[40vh] overflow-y-auto overscroll-contain sm:max-h-72">
                {selectedSkills.map((skill) => (
                  <li
                    key={`${skill.source}/${skill.skillId}`}
                    className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-surface-hover"
                  >
                    <div className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{skill.name}</span>
                      <span className="ml-2 text-muted-foreground">
                        {skill.source}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSkill(skill.source, skill.skillId)}
                      aria-label={`Remove ${skill.name} from stack`}
                      className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50"
                    >
                      <HugeiconsIcon
                        icon={Cancel01Icon}
                        strokeWidth={2}
                        className="size-3.5"
                      />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-2 px-3 py-2 sm:px-4">
                {/* The header Clear all icon is sm+ only; this gives mobile
                    an equivalent, with the same undo toast. */}
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={handleClearAll}
                  className="text-muted-foreground sm:hidden"
                >
                  Clear all
                </Button>
                {/* Compare stays rendered outside its 2–3 range — a button
                    that silently vanishes at the 4th selection makes the
                    constraint impossible to learn. Disabled buttons can't
                    show tooltips (pointer-events-none), so the rule is
                    stated as visible text instead. */}
                {!canCompare && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {count < 2
                      ? "Pick 2–3 skills to compare"
                      : "Compare works with 2–3 skills"}
                  </span>
                )}
                <Button
                  variant="outline"
                  size="xs"
                  className={cn(canCompare && "ml-auto")}
                  disabled={!canCompare}
                  onClick={() => {
                    router.push(
                      compareHref(
                        selectedSkills.map((s) => ({
                          source: s.source,
                          skillId: s.skillId,
                        })),
                      ),
                    );
                  }}
                  leadingIcon={
                    <HugeiconsIcon
                      icon={ArrowUpDownIcon}
                      strokeWidth={2}
                      className="size-3.5"
                    />
                  }
                >
                  Compare
                </Button>
              </div>
              <div className="h-px bg-border" />
            </CollapsibleContent>
          </Collapsible>

          <div className="flex items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4 sm:py-2.5">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={isOpen}
              aria-controls="bundle-tray"
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-1 pr-2 pl-1 text-left transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/12 text-primary">
                <HugeiconsIcon
                  icon={Album02Icon}
                  strokeWidth={2}
                  className="size-4"
                />
              </span>
              <span className="min-w-0 truncate text-sm font-medium tabular-nums">
                {count} skill{count !== 1 ? "s" : ""}
              </span>
              <HugeiconsIcon
                icon={ArrowUp01Icon}
                strokeWidth={2}
                className={cn(
                  "ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-300 sm:ml-0",
                  isOpen ? "rotate-0" : "rotate-180",
                )}
              />
            </button>

            <div className="hidden h-5 w-px shrink-0 bg-border sm:block" />

            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon_sm"
                      onClick={handleClearAll}
                      aria-label="Clear all selected skills"
                      className="text-muted-foreground max-sm:hidden"
                    />
                  }
                >
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    strokeWidth={2}
                    className="size-3.5"
                  />
                </TooltipTrigger>
                <TooltipContent sideOffset={8}>Clear all</TooltipContent>
              </Tooltip>

              <Button
                variant="outline"
                size="sm"
                disabled={wellKnownPending}
                onClick={handleCopy}
                leadingIcon={
                  <HugeiconsIcon
                    icon={Copy01Icon}
                    strokeWidth={2}
                    className="size-3.5"
                  />
                }
              >
                {copied ? "Copied!" : "Copy install"}
              </Button>

              <Button
                variant="primary"
                size="sm"
                onClick={handleSave}
                leadingIcon={
                  <HugeiconsIcon
                    icon={Download01Icon}
                    strokeWidth={2}
                    className="size-3.5"
                  />
                }
              >
                Save bundle
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <SaveBundleDialog handle={saveBundleDialogHandle} />
    </>
  );
}
