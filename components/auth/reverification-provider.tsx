"use client";

import * as React from "react";
import { useUser, useSession } from "@clerk/nextjs";
import { Button } from "@/components/ui/cubby-ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/cubby-ui/dialog";
import { CodeField } from "@/components/auth/code-field";
import { useResendTimer } from "@/hooks/use-resend-timer";
import { cn, getClerkErrorMessage } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Reverification context
// ---------------------------------------------------------------------------

type ReverificationCallbacks = {
  complete: () => void;
  cancel: () => void;
};

type ReverificationContextValue = {
  onNeedsReverification: (callbacks: ReverificationCallbacks) => void;
};

const ReverificationContext =
  React.createContext<ReverificationContextValue | null>(null);

export function useReverificationFlow() {
  const ctx = React.use(ReverificationContext);
  if (!ctx) {
    throw new Error(
      "useReverificationFlow must be used within a ReverificationProvider",
    );
  }
  return ctx.onNeedsReverification;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

type ReverificationState = {
  complete: () => void;
  cancel: () => void;
  inProgress: boolean;
};

export function ReverificationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useUser();
  const [reverification, setReverification] =
    React.useState<ReverificationState>();

  const onNeedsReverification = React.useCallback(
    ({ complete, cancel }: ReverificationCallbacks) => {
      setReverification({ complete, cancel, inProgress: true });
    },
    [],
  );

  const contextValue = React.useMemo(
    () => ({ onNeedsReverification }),
    [onNeedsReverification],
  );

  return (
    <ReverificationContext value={contextValue}>
      {children}
      <ReverificationDialog
        open={reverification?.inProgress ?? false}
        email={user?.primaryEmailAddress?.emailAddress ?? ""}
        onComplete={() => {
          reverification?.complete();
          setReverification(undefined);
        }}
        onCancel={() => {
          reverification?.cancel();
          setReverification(undefined);
        }}
      />
    </ReverificationContext>
  );
}

// ---------------------------------------------------------------------------
// Dialog (private to this module)
// ---------------------------------------------------------------------------

function ReverificationDialog({
  open,
  email,
  onComplete,
  onCancel,
}: {
  open: boolean;
  email: string;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const { session } = useSession();
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState("");
  const [ready, setReady] = React.useState(false);
  const [emailAddressId, setEmailAddressId] = React.useState("");
  const { countdown, startTimer, resetTimer } = useResendTimer();
  const startedRef = React.useRef(false);

  React.useEffect(() => {
    if (!open || startedRef.current || !session) return;
    startedRef.current = true;

    (async () => {
      try {
        const res = await session.startVerification({ level: "first_factor" });

        if (res.status === "complete") {
          onComplete();
          return;
        }

        if (res.status === "needs_first_factor") {
          const emailFactor = res.supportedFirstFactors?.find(
            (f) => f.strategy === "email_code",
          );
          if (emailFactor && "emailAddressId" in emailFactor) {
            setEmailAddressId(emailFactor.emailAddressId);
            await session.prepareFirstFactorVerification({
              strategy: "email_code",
              emailAddressId: emailFactor.emailAddressId,
            });
            setReady(true);
            startTimer();
          }
        }
      } catch (err) {
        setError(getClerkErrorMessage(err, "Failed to start verification"));
        setReady(true);
      }
    })();
  }, [open, session, startTimer, onComplete]);

  // Reset state when dialog closes
  React.useEffect(() => {
    if (!open) {
      setCode("");
      setError("");
      setReady(false);
      setEmailAddressId("");
      resetTimer();
      startedRef.current = false;
    }
  }, [open, resetTimer]);

  const handleResend = async () => {
    if (countdown > 0 || !session || !emailAddressId) return;
    try {
      await session.prepareFirstFactorVerification({
        strategy: "email_code",
        emailAddressId,
      });
      startTimer();
      setCode("");
      setError("");
    } catch (err) {
      setError(getClerkErrorMessage(err, "Failed to resend code"));
    }
  };

  const handleVerify = async (value?: string) => {
    setError("");
    try {
      await session?.attemptFirstFactorVerification({
        strategy: "email_code",
        code: value ?? code,
      });
      onComplete();
    } catch (err) {
      setError(getClerkErrorMessage(err, "Verification failed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent variant="inset">
        <DialogHeader className="text-center">
          <DialogTitle>Verification required</DialogTitle>
          <DialogDescription>
            Enter the code sent to your email to continue
          </DialogDescription>
          {email && <p className="text-sm font-medium">{email}</p>}
        </DialogHeader>
        <DialogBody className="flex flex-col items-center gap-4">
          <CodeField
            value={code}
            onValueChange={setCode}
            onComplete={ready ? handleVerify : undefined}
            disabled={!ready}
            invalid={!!error}
            variant="elevated"
            autoFocus
          />
          <button
            type="button"
            className={cn(
              "text-sm text-muted-foreground",
              countdown > 0 || !ready
                ? "cursor-default"
                : "cursor-pointer underline underline-offset-2 hover:text-foreground",
            )}
            onClick={handleResend}
            disabled={countdown > 0 || !ready}
          >
            {!ready
              ? "Sending code\u2026"
              : countdown > 0
                ? `Didn\u2019t receive a code? Resend (${countdown})`
                : "Didn\u2019t receive a code? Resend"}
          </button>
          {process.env.NODE_ENV === "development" && (
            <p className="text-xs text-muted-foreground">
              Dev mode: use{" "}
              <code className="rounded bg-muted px-1 py-0.5">+clerk_test</code>{" "}
              emails. Code:{" "}
              <code className="rounded bg-muted px-1 py-0.5">424242</code>
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button
            className="w-full"
            onClick={() => handleVerify()}
            disabled={!ready || code.length < 6}
          >
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
