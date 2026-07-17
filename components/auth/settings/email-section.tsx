"use client";

import * as React from "react";
import { useUser, useReverification } from "@clerk/nextjs";
import { isReverificationCancelledError } from "@clerk/nextjs/errors";
import { HugeiconsIcon } from "@hugeicons/react";
import { MoreHorizontalIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/cubby-ui/button";
import { Input } from "@/components/ui/cubby-ui/input";
import { Label } from "@/components/ui/cubby-ui/label";
import { Badge } from "@/components/ui/cubby-ui/badge";
import { Card, CardContent } from "@/components/ui/cubby-ui/card";
import { Separator } from "@/components/ui/cubby-ui/separator";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/cubby-ui/dropdown-menu";
import { CodeField } from "@/components/auth/code-field";
import { Crossfade } from "@/components/ui/cubby-ui/crossfade";
import { useResendTimer } from "@/hooks/use-resend-timer";
import { useReverificationFlow } from "./reverification-provider";
import { cn, getClerkErrorMessage } from "@/lib/utils";

export function EmailSection() {
  const { user } = useUser();
  const [adding, setAdding] = React.useState(false);
  const [newEmail, setNewEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [verifying, setVerifying] = React.useState(false);
  const [emailObj, setEmailObj] =
    React.useState<
      NonNullable<ReturnType<typeof useUser>["user"]>["emailAddresses"][number]
    >();
  const [error, setError] = React.useState("");
  const {
    countdown: resendCountdown,
    startTimer: startResendTimer,
    resetTimer: resetResendTimer,
  } = useResendTimer();

  const onNeedsReverification = useReverificationFlow();

  const createEmail = useReverification(
    (emailAddr: string) => user?.createEmailAddress({ email: emailAddr }),
    { onNeedsReverification },
  );

  const destroyEmail = useReverification(
    (emailId: string) => {
      const email = user?.emailAddresses.find((e) => e.id === emailId);
      return email?.destroy();
    },
    { onNeedsReverification },
  );

  if (!user) return null;

  const resetForm = () => {
    setAdding(false);
    setVerifying(false);
    setNewEmail("");
    setCode("");
    setError("");
    setEmailObj(undefined);
    resetResendTimer();
  };

  const handleAddEmail = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError("");
    try {
      const res = await createEmail(newEmail);
      if (!res) return;
      await user.reload();
      const emailAddress = user.emailAddresses.find((a) => a.id === res.id);
      setEmailObj(emailAddress);
      await emailAddress?.prepareVerification({ strategy: "email_code" });
      setVerifying(true);
      startResendTimer();
    } catch (err) {
      if (isReverificationCancelledError(err)) return;
      setError(getClerkErrorMessage(err, "Failed to add email"));
    }
  };

  const handleVerify = async (verifyCode?: string) => {
    setError("");
    const codeToUse = verifyCode ?? code;
    try {
      const result = await emailObj?.attemptVerification({ code: codeToUse });
      if (result?.verification.status === "verified") {
        await user.reload();
        resetForm();
      }
    } catch (err) {
      setError(getClerkErrorMessage(err, "Invalid code"));
    }
  };

  const handleResendEmail = async () => {
    if (resendCountdown > 0 || !emailObj) return;
    try {
      await emailObj.prepareVerification({ strategy: "email_code" });
      startResendTimer();
      setCode("");
      setError("");
    } catch (err) {
      setError(getClerkErrorMessage(err, "Failed to resend code"));
    }
  };

  const handleStartVerify = async (emailId: string) => {
    const emailAddress = user.emailAddresses.find((e) => e.id === emailId);
    if (!emailAddress) return;
    try {
      setEmailObj(emailAddress);
      setNewEmail(emailAddress.emailAddress);
      await emailAddress.prepareVerification({ strategy: "email_code" });
      setAdding(true);
      setVerifying(true);
      startResendTimer();
    } catch (err) {
      setError(getClerkErrorMessage(err, "Failed to start verification"));
    }
  };

  const handleRemoveEmail = async (emailId: string) => {
    try {
      await destroyEmail(emailId);
      await user.reload();
    } catch (err) {
      if (isReverificationCancelledError(err)) return;
      console.error("Failed to remove email:", err);
    }
  };

  const handleSetPrimary = async (emailId: string) => {
    try {
      await user.update({ primaryEmailAddressId: emailId });
      await user.reload();
    } catch (err) {
      console.error("Failed to set primary email:", err);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Card className="py-3">
        <CardContent className="flex flex-col gap-3">
          {user.emailAddresses.map((email) => {
            const isPrimary = email.id === user.primaryEmailAddressId;
            const isVerified = email.verification?.status === "verified";
            return (
              <div key={email.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{email.emailAddress}</span>
                  {isPrimary && <Badge variant="secondary">Primary</Badge>}
                  {!isVerified && <Badge variant="outline">Unverified</Badge>}
                </div>
                {!isPrimary && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="sm"
                          className="size-8 p-0"
                        />
                      }
                    >
                      <HugeiconsIcon icon={MoreHorizontalIcon} size={16} />
                      <span className="sr-only">Actions</span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {!isVerified && (
                        <DropdownMenuItem
                          onClick={() => handleStartVerify(email.id)}
                        >
                          Verify
                        </DropdownMenuItem>
                      )}
                      {isVerified && (
                        <DropdownMenuItem
                          onClick={() => handleSetPrimary(email.id)}
                        >
                          Set primary
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => handleRemoveEmail(email.id)}
                      >
                        Remove email
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Crossfade active={adding}>
        {/* Button */}
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => setAdding(true)}
        >
          + Add email address
        </Button>

        {/* Add email form */}
        <div className="flex flex-col gap-4">
          <Separator />
          <div className="flex flex-col gap-1">
            <h4 className="text-sm font-medium">
              {verifying ? "Verify email address" : "Add email address"}
            </h4>
            <p className="text-sm text-muted-foreground">
              {verifying
                ? `Enter the code sent to ${newEmail}`
                : "You\u2019ll need to verify this email address before it can be added to your account."}
            </p>
          </div>
          {!verifying ? (
            <form onSubmit={handleAddEmail} className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="addEmail">Email address</Label>
                <Input
                  id="addEmail"
                  type="email"
                  placeholder="Enter your email address"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  required
                />
                {process.env.NODE_ENV === "development" && (
                  <p className="text-muted-foreground text-xs">
                    Dev mode: use{" "}
                    <code className="bg-muted rounded px-1 py-0.5">
                      +clerk_test
                    </code>{" "}
                    emails (e.g. name+clerk_test@example.com). Code:{" "}
                    <code className="bg-muted rounded px-1 py-0.5">424242</code>
                  </p>
                )}
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </form>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <CodeField
                value={code}
                onValueChange={setCode}
                onComplete={handleVerify}
                invalid={!!error}
                autoFocus
              />
              <button
                type="button"
                className={cn(
                  "text-muted-foreground text-sm",
                  resendCountdown > 0
                    ? "cursor-default"
                    : "hover:text-foreground cursor-pointer underline underline-offset-2",
                )}
                onClick={handleResendEmail}
                disabled={resendCountdown > 0}
              >
                {resendCountdown > 0
                  ? `Didn\u2019t receive a code? Resend (${resendCountdown})`
                  : "Didn\u2019t receive a code? Resend"}
              </button>
              {process.env.NODE_ENV === "development" && (
                <p className="text-muted-foreground text-xs">
                  Dev mode: code is{" "}
                  <code className="bg-muted rounded px-1 py-0.5">424242</code>
                </p>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={resetForm}>
              Cancel
            </Button>
            {!verifying ? (
              <Button size="sm" onClick={handleAddEmail}>
                Add
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => handleVerify()}
                disabled={code.length < 6}
              >
                Verify
              </Button>
            )}
          </div>
        </div>
      </Crossfade>
    </div>
  );
}
