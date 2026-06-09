"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogClose,
  createDialogHandle,
} from "@/components/ui/cubby-ui/dialog";
import { Input } from "@/components/ui/cubby-ui/input";
import { Textarea } from "@/components/ui/cubby-ui/textarea";
import { Button } from "@/components/ui/cubby-ui/button";
import { Switch } from "@/components/ui/cubby-ui/switch";
import { Badge } from "@/components/ui/cubby-ui/badge";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/cubby-ui/tooltip";
import { useBundleActions, useSelectedSkills } from "@/lib/bundle-selection";
import { useUserPlan } from "@/hooks/use-user-plan";
import { UpgradeBanner } from "@/components/upgrade-banner";
import { toast } from "@/components/ui/cubby-ui/toast/toast";
import { MAX_BUNDLE_DESCRIPTION_LENGTH } from "@/lib/bundle-limits";

export type SaveBundleDialogHandle = ReturnType<typeof createDialogHandle>;

export function createSaveBundleDialogHandle(): SaveBundleDialogHandle {
  return createDialogHandle();
}

interface SaveBundleDialogProps {
  handle: SaveBundleDialogHandle;
}

export function SaveBundleDialog({ handle }: SaveBundleDialogProps) {
  const selectedSkills = useSelectedSkills();
  const { clearAll } = useBundleActions();
  const createBundle = useMutation(api.bundles.createBundle);
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [saving, setSaving] = useState(false);
  const { limits } = useUserPlan();
  const bundleCount = useQuery(api.bundles.countByUser);
  const atLimit =
    limits !== null &&
    bundleCount !== undefined &&
    bundleCount >= limits.maxBundles;
  const count = selectedSkills.length;

  const trimmedDescription = description.trim();
  const descriptionOverLimit =
    trimmedDescription.length > MAX_BUNDLE_DESCRIPTION_LENGTH;

  async function handleSave() {
    if (!name.trim() || count === 0 || descriptionOverLimit) return;

    setSaving(true);
    try {
      const result = await createBundle({
        name: name.trim(),
        description:
          trimmedDescription.length > 0 ? trimmedDescription : undefined,
        skills: selectedSkills.map(({ source, skillId }) => ({
          source,
          skillId,
        })),
        isPublic,
      });

      clearAll();
      setName("");
      setDescription("");
      handle.close();
      router.push(`/bundle/${result.urlId}`);
    } catch (error) {
      let message = "Failed to save bundle";
      if (error instanceof ConvexError && typeof error.data === "string") {
        message = error.data;
      } else if (error instanceof Error) {
        message = error.message;
      }
      toast.error({ title: "Cannot save bundle", description: message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog handle={handle}>
      <DialogContent variant="inset">
        <DialogHeader>
          <DialogTitle className="font-display">Save bundle</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {atLimit ? (
            <UpgradeBanner
              message={`You've reached your limit of ${limits.maxBundles} bundles. Upgrade to Pro for unlimited bundles.`}
            />
          ) : (
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="bundle-name"
                  className="text-sm font-medium mb-1.5 block"
                >
                  Bundle name
                </label>
                <Input
                  id="bundle-name"
                  placeholder="My React stack"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSave();
                  }}
                />
              </div>
              <div>
                <label
                  htmlFor="bundle-description"
                  className="text-sm font-medium mb-1.5 block"
                >
                  Description
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    Optional
                  </span>
                </label>
                <Textarea
                  id="bundle-description"
                  placeholder="What's this bundle for?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-20"
                  maxLength={MAX_BUNDLE_DESCRIPTION_LENGTH + 50}
                />
                <div className="mt-1 flex items-center justify-end text-xs text-muted-foreground tabular-nums">
                  <span
                    className={
                      descriptionOverLimit
                        ? "text-destructive font-medium"
                        : undefined
                    }
                  >
                    {trimmedDescription.length} / {MAX_BUNDLE_DESCRIPTION_LENGTH}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <label htmlFor="bundle-public" className="text-sm font-medium">
                  Public bundle
                  {limits && !limits.canMakePrivate && (
                    <Badge variant="outline" className="ml-2 text-[10px]">
                      Pro
                    </Badge>
                  )}
                </label>
                {limits && !limits.canMakePrivate ? (
                  <Tooltip>
                    <TooltipTrigger render={<div />}>
                      <Switch id="bundle-public" checked={true} disabled />
                    </TooltipTrigger>
                    <TooltipContent sideOffset={8}>
                      Upgrade to Pro to make bundles private
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <Switch
                    id="bundle-public"
                    checked={isPublic}
                    onCheckedChange={setIsPublic}
                  />
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {count} skill{count !== 1 ? "s" : ""} will be saved.{" "}
                {isPublic
                  ? "Anyone with the link can view your bundle."
                  : "Only you can see this bundle."}
              </p>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" disabled={saving}>
                Cancel
              </Button>
            }
          />
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={
              atLimit || !name.trim() || saving || descriptionOverLimit
            }
            loading={saving}
          >
            {saving ? "Saving…" : "Save bundle"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
