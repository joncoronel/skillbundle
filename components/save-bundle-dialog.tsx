"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/cubby-ui/dialog";
import { Input } from "@/components/ui/cubby-ui/input";
import { Button } from "@/components/ui/cubby-ui/button";
import { Switch } from "@/components/ui/cubby-ui/switch";
import { Badge } from "@/components/ui/cubby-ui/badge";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/cubby-ui/tooltip";
import {
  useBundleActions,
  useSelectedSkills,
} from "@/lib/bundle-selection";
import { useUserPlan } from "@/hooks/use-user-plan";
import { UpgradeBanner } from "@/components/upgrade-banner";
import { toast } from "@/components/ui/cubby-ui/toast/toast";

interface SaveBundleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SaveBundleDialog({
  open,
  onOpenChange,
}: SaveBundleDialogProps) {
  const selectedSkills = useSelectedSkills();
  const { clearAll } = useBundleActions();
  const createBundle = useMutation(api.bundles.createBundle);
  const router = useRouter();
  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [saving, setSaving] = useState(false);
  const { limits } = useUserPlan();
  const bundleCount = useQuery(api.bundles.countByUser);
  const atLimit =
    limits !== null &&
    bundleCount !== undefined &&
    bundleCount >= limits.maxBundles;
  const count = selectedSkills.length;

  async function handleSave() {
    if (!name.trim() || count === 0) return;

    setSaving(true);
    try {
      const result = await createBundle({
        name: name.trim(),
        skills: selectedSkills.map(({ source, skillId }) => ({
          source,
          skillId,
        })),
        isPublic,
      });

      clearAll();
      setName("");
      onOpenChange(false);
      router.push(`/stack/${result.urlId}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save bundle";
      toast.error({ title: "Cannot save bundle", description: message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                      <Switch
                        id="bundle-public"
                        checked={true}
                        disabled
                      />
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
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={atLimit || !name.trim() || saving}
            loading={saving}
          >
            Save bundle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
