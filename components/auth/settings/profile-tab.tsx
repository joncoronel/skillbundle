"use client";

import * as React from "react";
import { useUser } from "@clerk/nextjs";
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from "@/components/ui/cubby-ui/avatar";
import { HugeiconsIcon } from "@hugeicons/react";
import { Upload01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/cubby-ui/button";
import { Input } from "@/components/ui/cubby-ui/input";
import { Label } from "@/components/ui/cubby-ui/label";
import { Separator } from "@/components/ui/cubby-ui/separator";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { Crossfade } from "@/components/ui/cubby-ui/crossfade";
import { toast } from "@/components/ui/cubby-ui/toast/toast";
import { SettingsSection } from "./settings-section";
import { EmailSection } from "./email-section";
import { ConnectedAccountsSection } from "./connected-accounts-section";
import { getClerkErrorMessage, getInitials } from "@/lib/utils";

/**
 * Mirrors the three sections `ProfileTab` actually renders — Profile, Email
 * addresses, Connected accounts — in their resting shapes.
 *
 * Both halves of that are easy to get wrong and neither fails loudly. This
 * skeleton previously drew two sections and gave the first one the *editing*
 * layout (two name fields), so Clerk resolving grew the panel by a whole
 * section and reshaped the one above it. The container writes its height from
 * a ResizeObserver with no transition on this path, so that arrived as a hard
 * jump rather than as a fade, reading like a second, different skeleton.
 *
 * Restructure the sections below and this has to move with them.
 */
function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-10">
      {/* Profile: avatar, name, "Update profile" */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-10">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="flex items-center justify-between lg:col-span-2">
          <div className="flex items-center gap-4">
            <Skeleton className="size-12 rounded-full" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="h-8 w-32" />
        </div>
      </div>
      <Separator />
      {/* Email addresses: one address row, then "Add email address". `h-14`
          tracks the `min-h-14` on the real rows in `email-section.tsx`. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-10">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex flex-col gap-3 lg:col-span-2">
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-8 w-36" />
        </div>
      </div>
      <Separator />
      {/* Connected accounts: one provider row, then the connect buttons */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-10">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-44" />
        </div>
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Skeleton className="h-14 w-full rounded-lg" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-28" />
            {/* One row + one remaining provider: the shape for a user who
                signed in with Google or GitHub, which is most of them. */}
            <Skeleton className="h-8 w-36" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProfileTab() {
  const { isLoaded, user } = useUser();
  const [editing, setEditing] = React.useState(false);
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [pendingAvatarFile, setPendingAvatarFile] = React.useState<File | null>(
    null,
  );
  const [pendingAvatarRemove, setPendingAvatarRemove] = React.useState(false);
  const [pendingAvatarPreview, setPendingAvatarPreview] = React.useState<
    string | null
  >(null);
  const [avatarError, setAvatarError] = React.useState("");
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Clean up object URL on unmount or when preview changes
  React.useEffect(() => {
    return () => {
      if (pendingAvatarPreview) URL.revokeObjectURL(pendingAvatarPreview);
    };
  }, [pendingAvatarPreview]);

  if (!isLoaded || !user) return <ProfileSkeleton />;

  const initials = getInitials(user.firstName, user.lastName);

  const startEditing = () => {
    setFirstName(user.firstName ?? "");
    setLastName(user.lastName ?? "");
    setEditing(true);
  };

  const resetPendingAvatar = () => {
    if (pendingAvatarPreview) URL.revokeObjectURL(pendingAvatarPreview);
    setPendingAvatarFile(null);
    setPendingAvatarRemove(false);
    setPendingAvatarPreview(null);
    setAvatarError("");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await user.update({ firstName, lastName });
      if (pendingAvatarFile) {
        await user.setProfileImage({ file: pendingAvatarFile });
      } else if (pendingAvatarRemove) {
        await user.setProfileImage({ file: null });
      }
      resetPendingAvatar();
      setEditing(false);
    } catch (err) {
      // No matching success toast: on success the form crossfades back to the
      // summary showing the new name and avatar, which is the confirmation.
      // Only the failure needs saying, and it used to say nothing.
      toast.error({
        title: "Could not save your profile",
        description: getClerkErrorMessage(err, "Please try again."),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_SIZE) {
      setAvatarError("File size must be under 10MB.");
      return;
    }
    setAvatarError("");

    if (pendingAvatarPreview) URL.revokeObjectURL(pendingAvatarPreview);
    setPendingAvatarFile(file);
    setPendingAvatarRemove(false);
    setPendingAvatarPreview(URL.createObjectURL(file));
  };

  const handleAvatarRemove = () => {
    resetPendingAvatar();
    setPendingAvatarRemove(true);
  };

  return (
    <div className="flex flex-col gap-10">
      <SettingsSection
        title="Profile"
        description="Manage your public profile information"
      >
        <Crossfade active={editing}>
          {/* Read-only summary */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Avatar size="lg">
                <AvatarImage
                  src={user.imageUrl}
                  alt={user.fullName ?? "Avatar"}
                />
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col">
                <span className="text-sm font-medium">
                  {user.fullName || "No name set"}
                </span>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={startEditing}>
              Update profile
            </Button>
          </div>

          {/* Edit form */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <Avatar size="lg">
                {!pendingAvatarRemove && (
                  <AvatarImage
                    src={pendingAvatarPreview ?? user.imageUrl}
                    alt={user.fullName ?? "Avatar"}
                  />
                )}
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    leadingIcon={
                      <HugeiconsIcon
                        icon={Upload01Icon}
                        strokeWidth={2}
                        className="size-3.5"
                      />
                    }
                  >
                    Upload
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={handleAvatarRemove}
                    leadingIcon={
                      <HugeiconsIcon
                        icon={Cancel01Icon}
                        strokeWidth={2}
                        className="size-3.5"
                      />
                    }
                  >
                    Remove
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleAvatarUpload}
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  Recommended size 1:1, up to 10MB.
                </span>
                {avatarError && (
                  <span className="text-xs text-destructive">
                    {avatarError}
                  </span>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="firstName">First name</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="lastName">Last name</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  resetPendingAvatar();
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </Crossfade>
      </SettingsSection>

      <Separator />

      <SettingsSection
        title="Email addresses"
        description="Manage your email addresses and set your primary email"
      >
        <EmailSection />
      </SettingsSection>

      <Separator />

      <SettingsSection
        title="Connected accounts"
        description="Manage your linked social accounts"
      >
        <ConnectedAccountsSection />
      </SettingsSection>
    </div>
  );
}
