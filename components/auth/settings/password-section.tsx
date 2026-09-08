"use client";

import * as React from "react";
import { useUser, useReverification } from "@clerk/nextjs";
import { isReverificationCancelledError } from "@clerk/nextjs/errors";
import { Button } from "@/components/ui/cubby-ui/button";
import { Input } from "@/components/ui/cubby-ui/input";
import { Label } from "@/components/ui/cubby-ui/label";
import { Checkbox } from "@/components/ui/cubby-ui/checkbox";
import { Crossfade } from "@/components/ui/cubby-ui/crossfade";
import { toast } from "@/components/ui/cubby-ui/toast/toast";
import { useReverificationFlow } from "@/components/auth/reverification-provider";
import { getClerkErrorMessage } from "@/lib/utils";

export function PasswordSection({ hasPassword }: { hasPassword: boolean }) {
  const { user } = useUser();
  const [editing, setEditing] = React.useState(false);
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [signOutOthers, setSignOutOthers] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  const onNeedsReverification = useReverificationFlow();

  const updatePassword = useReverification(
    (params: Parameters<NonNullable<typeof user>["updatePassword"]>[0]) =>
      user?.updatePassword(params),
    { onNeedsReverification },
  );

  if (!user) return null;

  const resetForm = () => {
    setEditing(false);
    setNewPassword("");
    setConfirmPassword("");
    setSignOutOthers(true);
    setError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await updatePassword({
        newPassword,
        signOutOfOtherSessions: signOutOthers,
      });
      resetForm();
      // Toast, not inline text on a timer. A password change leaves nothing on
      // screen that looks different, so it needs its own confirmation — and the
      // previous `setTimeout(…, 3000)` was never cleared, so switching tabs
      // inside that window set state on an unmounted component.
      toast.success({
        title: "Password updated",
        description: signOutOthers
          ? "Your other devices have been signed out."
          : undefined,
      });
    } catch (err) {
      if (isReverificationCancelledError(err)) return;
      setError(getClerkErrorMessage(err, "Failed to update password"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Crossfade active={editing}>
      {/* Button */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          {hasPassword ? "Change password" : "Set password"}
        </Button>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="flex max-w-sm flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="newPassword">New password</Label>
          <Input
            id="newPassword"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>
        <label className="flex items-start gap-3">
          <Checkbox
            checked={signOutOthers}
            onCheckedChange={(checked) => setSignOutOthers(checked === true)}
            className="mt-0.5"
          />
          <div className="flex flex-col">
            <span className="text-sm font-medium">
              Sign out of all other devices
            </span>
            <span className="text-xs text-muted-foreground">
              It is recommended to sign out of all other devices which may have
              used your old password.
            </span>
          </div>
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
            Cancel
          </Button>
        </div>
      </form>
    </Crossfade>
  );
}
