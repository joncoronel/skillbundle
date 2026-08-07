"use client";

import * as React from "react";
import { useUser, useClerk, useReverification } from "@clerk/nextjs";
import { isReverificationCancelledError } from "@clerk/nextjs/errors";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { DangerIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/cubby-ui/button";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogClose,
} from "@/components/ui/cubby-ui/alert-dialog";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { toast } from "@/components/ui/cubby-ui/toast/toast";
import { useReverificationFlow } from "@/components/auth/reverification-provider";
import { getClerkErrorMessage } from "@/lib/utils";

function DangerZoneSkeleton() {
  return <Skeleton className="h-9 w-32" />;
}

export function DangerZone() {
  const { isLoaded, user } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const onNeedsReverification = useReverificationFlow();

  // Deleting an account is a protected action: Clerk rejects it with
  // `session_reverification_required` unless the session was verified recently.
  // `onNeedsReverification` routes that into our own OTP dialog, then retries.
  const deleteAccount = useReverification(() => user?.delete(), {
    onNeedsReverification,
  });

  if (!isLoaded || !user) return <DangerZoneSkeleton />;

  const handleDelete = async () => {
    // Close this dialog before the reverification dialog opens, otherwise the
    // alert dialog's focus trap swallows input meant for the code field.
    setOpen(false);
    setDeleting(true);
    try {
      await deleteAccount();
    } catch (err) {
      if (!isReverificationCancelledError(err)) {
        toast.error({
          title: "Could not delete account",
          description: getClerkErrorMessage(err, "Please try again."),
        });
      }
      setDeleting(false);
      return;
    }
    // `user.delete()` already ended the session, so `signOut` has nothing left
    // to do and its redirect never fires, stranding us on a settings page with
    // no user. Clear any leftover client state, then navigate ourselves. The
    // `redirectUrl` only matters if Clerk does redirect: it keeps us off the
    // provider's `afterSignOutUrl` (/sign-in), which is wrong for a deleted
    // account. Either way we land on "/".
    await signOut({ redirectUrl: "/" }).catch(() => {});
    router.push("/");
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="destructive-soft" disabled={deleting} leadingIcon={<HugeiconsIcon icon={DangerIcon} strokeWidth={2} className="size-4" />} />}>
        {deleting ? "Deleting..." : "Delete account"}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Are you sure you want to delete your account?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. All your data, bundles, and
            settings will be permanently removed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>
            Cancel
          </AlertDialogClose>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? "Deleting..." : "Delete account"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
