"use client";

import * as React from "react";
import { useSignUp, useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/cubby-ui/input";
import { useResendTimer } from "@/hooks/use-resend-timer";
import { AuthFrame } from "./auth-frame";
import { OAuthButtons } from "./oauth-buttons";
import {
  AuthCodeGroup,
  AuthCrossButton,
  AuthCrossLink,
  AuthDivider,
  AuthFieldError,
  AuthFieldLabel,
  AuthFooterPrompt,
  AuthFormError,
  AuthPasswordField,
  AuthPendingBody,
  AuthSubmitButton,
  isExpiredCodeError,
  navigateAfterAuth,
  resolveClerkErrorMessage,
} from "./shared";

export function SignUpForm() {
  const { signUp, errors } = useSignUp();
  const { isSignedIn } = useAuth();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [resendError, setResendError] = React.useState<string | null>(null);
  const [advancedToVerify, setAdvancedToVerify] = React.useState(false);
  const { countdown, startTimer, resetTimer } = useResendTimer();
  const router = useRouter();

  const emailError = errors?.fields?.emailAddress;
  const passwordError = errors?.fields?.password;
  const codeError = errors?.fields?.code;
  const captchaError = errors?.fields?.captcha;
  const globalErrorMessages = [
    ...(errors?.global?.map((e) => resolveClerkErrorMessage(e)) ?? []),
    ...(captchaError ? [resolveClerkErrorMessage(captchaError)] : []),
    ...(resendError ? [resendError] : []),
  ];

  // Cache Components keeps this route mounted via React Activity on
  // navigation, which otherwise preserves form input values and transient
  // auth state between visits. Reset everything when the route becomes hidden
  // so returning to it is a fresh experience (the resend timer cleans up its
  // own interval).
  React.useLayoutEffect(() => {
    return () => {
      setEmail("");
      setPassword("");
      setCode("");
      setAdvancedToVerify(false);
      setResendError(null);
      // Reset the resend countdown so a frozen number can't survive a hide/show
      // (the interval is already cleaned up by the hook).
      resetTimer();
    };
  }, [resetTimer]);

  const submitSignUp = async () => {
    const { error } = await signUp.password({
      emailAddress: email,
      password,
    });
    if (error) return;

    try {
      // The actions API resolves with { error } instead of throwing, so a
      // failed send lands here — not the catch below.
      const { error: sendError } = await signUp.verifications.sendEmailCode();
      if (sendError) {
        // Account was created but the code wasn't sent. Don't advance —
        // surface the failure so the user knows to retry.
        setResendError(
          resolveClerkErrorMessage(sendError) ||
            "Couldn't send the verification code. Try again.",
        );
        return;
      }
      setAdvancedToVerify(true);
      startTimer();
    } catch {
      setResendError("Couldn't send the verification code. Try again.");
    }
  };

  const submitVerify = async (value: string) => {
    const { error } = await signUp.verifications.verifyEmailCode({
      code: value,
    });
    if (error) {
      // Expired code → clear so a fresh resend starts clean; a wrong code stays
      // put so the user can fix a digit.
      if (isExpiredCodeError(error)) setCode("");
      return;
    }

    if (signUp.status === "complete") {
      await signUp.finalize({
        navigate: ({ session, decorateUrl }) => {
          if (session?.currentTask) return;
          navigateAfterAuth(router, decorateUrl);
        },
      });
    }
  };

  const handleResend = async () => {
    if (countdown > 0) return;
    setResendError(null);
    try {
      const { error } = await signUp.verifications.sendEmailCode();
      if (error) {
        // Failed resend: keep the cooldown off and any typed digits intact so
        // the user can retry immediately.
        setResendError(
          resolveClerkErrorMessage(error) ||
            "Couldn't resend the code. Try again in a moment.",
        );
        return;
      }
      setCode("");
      startTimer();
    } catch {
      setResendError("Couldn't resend the code. Try again in a moment.");
    }
  };

  const isVerifyComplete =
    advancedToVerify && (signUp.status === "complete" || isSignedIn);

  const needsVerification =
    advancedToVerify &&
    signUp.status === "missing_requirements" &&
    signUp.unverifiedFields?.includes("email_address") &&
    signUp.missingFields?.length === 0;

  if (needsVerification || isVerifyComplete) {
    return (
      <AuthFrame
        title="Check your email."
        description={`We sent a 6-digit code to ${email}.`}
        footer={
          isVerifyComplete ? null : (
            <>
              <span className="text-muted-foreground">Didn&apos;t get it?</span>{" "}
              <AuthCrossButton onClick={handleResend} disabled={countdown > 0}>
                {countdown > 0 ? `Resend code (${countdown})` : "Resend code"}
              </AuthCrossButton>
            </>
          )
        }
      >
        <form
          action={(formData) =>
            submitVerify(String(formData.get("code") ?? ""))
          }
          className="flex flex-col gap-6"
        >
          <AuthCodeGroup
            value={code}
            onValueChange={setCode}
            autoSubmit={!isVerifyComplete}
            disabled={isVerifyComplete}
            invalid={!!codeError && !isVerifyComplete}
            autoFocus={!isVerifyComplete}
            errorMessage={
              codeError && !isVerifyComplete
                ? resolveClerkErrorMessage(codeError)
                : undefined
            }
          />

          {!isVerifyComplete && (
            <AuthFormError messages={globalErrorMessages} />
          )}

          {isVerifyComplete ? (
            <p
              role="status"
              className="text-center text-sm text-muted-foreground"
            >
              Verified. Signing you in…
            </p>
          ) : (
            <AuthSubmitButton idleLabel="Verify" pendingLabel="Verifying" />
          )}
        </form>
      </AuthFrame>
    );
  }

  if (signUp.status === "complete" || isSignedIn) {
    // Reached "complete" without having gone through our verify flow
    // (e.g. some edge case). Keep a minimal fallback so the layout stays stable.
    return (
      <AuthFrame title="Signing you in…" description="One moment.">
        <AuthPendingBody />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      title="New account."
      description="Start building your stack. Takes a minute."
      footer={
        <AuthFooterPrompt prompt="Already have an account?">
          <AuthCrossLink href="/sign-in">Sign in</AuthCrossLink>
        </AuthFooterPrompt>
      }
    >
      <div className="flex flex-col gap-6">
        <form action={submitSignUp} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <AuthFieldLabel htmlFor="email">Email</AuthFieldLabel>
            <Input
              id="email"
              type="email"
              variant="elevated"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? "email-error" : undefined}
            />
            {emailError && (
              <AuthFieldError
                id="email-error"
                message={resolveClerkErrorMessage(emailError, "email address")}
              />
            )}
          </div>

          <div className="flex flex-col gap-2">
            <AuthFieldLabel htmlFor="password">Password</AuthFieldLabel>
            <AuthPasswordField
              id="password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              invalid={!!passwordError}
              describedBy={passwordError ? "password-error" : undefined}
            />
            {passwordError && (
              <AuthFieldError
                id="password-error"
                message={resolveClerkErrorMessage(passwordError)}
              />
            )}
          </div>

          <AuthFormError messages={globalErrorMessages} />

          <AuthSubmitButton
            idleLabel="Create account"
            pendingLabel="Creating account"
            className="mt-2"
          />
        </form>

        <AuthDivider label="or" />

        <OAuthButtons mode="sign-up" />
      </div>

      {/* Outside the gapped column on purpose, and outside the form — Clerk only
          needs the element to exist by id, anywhere in the document.
          On submit Clerk mounts an invisible Turnstile widget here and collapses
          the container with an inline `max-height: 0`. That contract holds in
          normal flow but not in a flex column: a zero-height flex item still
          collects the column's gap, so mounting it inside the form grew the form
          by exactly one `gap-4` (208px → 224px, measured) and shoved the button
          down mid-submit. As the last block child of the card it contributes
          nothing when collapsed, and still has room to render for the rare
          falsely-flagged user who gets a real challenge. */}
      <div id="clerk-captcha" />
    </AuthFrame>
  );
}
