"use client";

import * as React from "react";
import { useSignUp, useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/cubby-ui/input";
import { useResendTimer } from "@/hooks/use-resend-timer";
import { AuthFrame } from "./auth-frame";
import { CodeField } from "./code-field";
import { OAuthButtons } from "./oauth-buttons";
import {
  AuthCrossButton,
  AuthCrossLink,
  AuthDivider,
  AuthFieldError,
  AuthFieldLabel,
  AuthFormError,
  AuthSubmitButton,
  isExpiredCodeError,
  navigateAfterAuth,
  resolveClerkErrorMessage,
  resolveClerkThrownError,
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
      await signUp.verifications.sendEmailCode();
      setAdvancedToVerify(true);
      startTimer();
    } catch (err) {
      // Account was created but the code wasn't sent. Don't advance —
      // surface the failure so the user knows to retry.
      setResendError(
        resolveClerkThrownError(
          err,
          "Couldn't send the verification code. Try again.",
        ),
      );
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
      await signUp.verifications.sendEmailCode();
      setCode("");
      startTimer();
    } catch (err) {
      setResendError(
        resolveClerkThrownError(
          err,
          "Couldn't resend the code. Try again in a moment.",
        ),
      );
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
            <AuthCrossButton onClick={handleResend} disabled={countdown > 0}>
              {countdown > 0 ? `resend code (${countdown})` : "resend code"}
            </AuthCrossButton>
          )
        }
      >
        <form
          action={(formData) =>
            submitVerify(String(formData.get("code") ?? ""))
          }
          className="flex flex-col gap-6"
        >
          <div className="flex flex-col gap-3">
            <AuthFieldLabel htmlFor="code">Verification code</AuthFieldLabel>
            <CodeField
              id="code"
              name="code"
              value={code}
              onValueChange={setCode}
              autoSubmit={!isVerifyComplete}
              disabled={isVerifyComplete}
              invalid={!!codeError && !isVerifyComplete}
              describedBy={codeError ? "code-error" : undefined}
              autoFocus={!isVerifyComplete}
            />
            {codeError && !isVerifyComplete && (
              <AuthFieldError
                id="code-error"
                message={resolveClerkErrorMessage(codeError)}
              />
            )}
          </div>

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
        <div />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      title="New account."
      description="Start building your stack. Takes a minute."
      footer={
        <AuthCrossLink href="/sign-in">
          already registered? sign in →
        </AuthCrossLink>
      }
    >
      <div className="flex flex-col gap-8">
        <OAuthButtons mode="sign-up" />

        <AuthDivider label="or email" />

        <form action={submitSignUp} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <AuthFieldLabel htmlFor="email">Email</AuthFieldLabel>
            <Input
              id="email"
              type="email"
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
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              aria-invalid={passwordError ? true : undefined}
              aria-describedby={passwordError ? "password-error" : undefined}
            />
            {passwordError && (
              <AuthFieldError
                id="password-error"
                message={resolveClerkErrorMessage(passwordError)}
              />
            )}
          </div>

          <div id="clerk-captcha" />

          <AuthFormError messages={globalErrorMessages} />

          <AuthSubmitButton
            idleLabel="Create account"
            pendingLabel="Creating account"
            className="mt-2"
          />
        </form>
      </div>
    </AuthFrame>
  );
}
