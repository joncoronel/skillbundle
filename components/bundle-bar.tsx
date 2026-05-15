"use client";

import { useEffect, useState } from "react";
import { useConvexAuth } from "convex/react";
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
import {
  useBundleActions,
  useSelectedSkills,
} from "@/lib/bundle-selection";
import { generateAllCommandsText } from "@/lib/install-commands";
import {
  SaveBundleDialog,
  createSaveBundleDialogHandle,
} from "@/components/save-bundle-dialog";
import { cn } from "@/lib/utils";

const saveBundleDialogHandle = createSaveBundleDialogHandle();

export function BundleBar() {
  const selectedSkills = useSelectedSkills();
  const { clearAll, removeSkill } = useBundleActions();
  const { isAuthenticated: isSignedIn } = useConvexAuth();
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const count = selectedSkills.length;
  const visible = count > 0;
  const isOpen = expanded && visible;

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
    const text = generateAllCommandsText(selectedSkills);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleSave() {
    if (!isSignedIn) {
      router.push("/sign-in");
      return;
    }
    saveBundleDialogHandle.open(null);
  }

  return (
    <>
      <Sheet open={visible} modal={false}>
        <SheetContent
          side="bottom"
          variant="floating"
          showCloseButton={false}
          className={cn(
            "flex flex-col overflow-hidden",
            "max-sm:inset-x-0 max-sm:bottom-0 max-sm:w-full max-sm:max-w-none max-sm:rounded-none max-sm:ring-0 max-sm:border-t max-sm:shadow-[0_-4px_20px_-4px_rgb(0_0_0/0.15)] max-sm:data-starting-style:translate-y-full max-sm:data-ending-style:translate-y-full",
            "sm:inset-x-auto sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-auto sm:max-w-[min(640px,calc(100vw-2rem))] sm:shadow-lg sm:ring-border sm:ring-1",
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
                    className="flex items-center gap-3 px-4 py-2 text-sm  hover:bg-muted/60 dark:hover:bg-muted"
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
                      className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring/50 focus-visible:outline-offset-2"
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
              {count >= 2 && count <= 3 && (
                <div className="flex justify-end px-3 py-2 sm:px-4">
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => {
                      const params = selectedSkills
                        .map((s) => `${s.source}:${s.skillId}`)
                        .join(",");
                      router.push(
                        `/compare?skills=${encodeURIComponent(params)}`,
                      );
                    }}
                    leftSection={
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
              )}
              <div className="h-px bg-border" />
            </CollapsibleContent>
          </Collapsible>

          <div className="flex items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4 sm:py-2.5">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={isOpen}
              aria-controls="bundle-tray"
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-1 pr-2 pl-1 text-left transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring/50 focus-visible:outline-offset-2"
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
                      onClick={clearAll}
                      aria-label="Clear all selected skills"
                      className="max-sm:hidden text-muted-foreground"
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
                onClick={handleCopy}
                leftSection={
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
                leftSection={
                  <HugeiconsIcon
                    icon={Download01Icon}
                    strokeWidth={2}
                    className="size-3.5"
                  />
                }
              >
                {isSignedIn ? "Save bundle" : "Sign in to save"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <SaveBundleDialog handle={saveBundleDialogHandle} />
    </>
  );
}
