"use client";

import * as React from "react";
import { useSignIn } from "@clerk/nextjs";
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

export function SignInForm() {
  const { signIn, errors } = useSignIn();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  // Set once Clerk asks for the email code and we've reached the code step.
  // Clerk's Client Trust triggers a second factor on password sign-in from a
  // new device even for accounts without user-configured MFA — the emailed code
  // proves it's them. Without this branch the form silently stalled there.
  const [verifying, setVerifying] = React.useState(false);
  const [flowError, setFlowError] = React.useState<string | null>(null);
  // The send-failure path lands on the verify screen without a code actually
  // sent — track it so the heading doesn't claim "we sent a code".
  const [sendFailed, setSendFailed] = React.useState(false);
  const { countdown, startTimer, resetTimer } = useResendTimer();
  const router = useRouter();

  // Cache Components keeps this route mounted via React Activity on navigation,
  // which otherwise preserves input values and transient auth state between
  // visits. Clear everything when the route becomes hidden.
  React.useLayoutEffect(() => {
    return () => {
      setEmail("");
      setPassword("");
      setCode("");
      setVerifying(false);
      setFlowError(null);
      setSendFailed(false);
      // Reset the resend countdown too: its interval is cleaned up on hide, but
      // the number would otherwise survive frozen — and the send-failure path
      // doesn't restart it, so a revisit could show a dead, permanently
      // disabled "resend code (N)".
      resetTimer();
    };
  }, [resetTimer]);

  const identifierError = errors?.fields?.identifier;
  const passwordError = errors?.fields?.password;
  const codeError = errors?.fields?.code;
  const globalErrorMessages = [
    ...(errors?.global?.map((e) => resolveClerkErrorMessage(e)) ?? []),
    ...(flowError ? [flowError] : []),
  ];

  const finalize = async () => {
    await signIn.finalize({
      navigate: ({ session, decorateUrl }) => {
        // No session tasks are configured in this app; if one is ever pending,
        // Clerk keeps the session incomplete and we don't navigate.
        if (session?.currentTask) return;
        navigateAfterAuth(router, decorateUrl);
      },
    });
  };

  const submit = async () => {
    setFlowError(null);
    setSendFailed(false);
    const { error } = await signIn.password({ identifier: email, password });
    if (error) return;

    if (signIn.status === "complete") {
      await finalize();
      return;
    }

    // Password accepted but Clerk wants a second factor. For this app that's
    // always the Client Trust email code (it exposes no MFA setup, so no
    // authenticator/SMS factors exist). Send it and advance to the code step.
    const emailFactor = signIn.supportedSecondFactors?.find(
      (factor) => factor.strategy === "email_code",
    );
    if (emailFactor) {
      try {
        await signIn.mfa.sendEmailCode();
        setVerifying(true);
        startTimer();
      } catch (err) {
        // Send failed after a correct password. Still advance to the code
        // screen (not back to the password form, whose only button re-runs an
        // already-past first factor) so the user can retry via "resend code" —
        // and don't start the cooldown, so resend is available immediately.
        setVerifying(true);
        setSendFailed(true);
        setFlowError(
          resolveClerkThrownError(
            err,
            "Couldn't send the code. Use resend to try again.",
          ),
        );
      }
      return;
    }

    // A non-email second factor (TOTP/SMS) — this app can't complete it, so say
    // so distinctly rather than looping on a generic "try again".
    setFlowError("This sign-in method isn't supported here yet.");
  };

  const verifyCode = async (value: string) => {
    setFlowError(null);
    const { error } = await signIn.mfa.verifyEmailCode({ code: value });
    if (error) {
      // Expired code → clear so a fresh resend starts clean; a wrong code stays
      // put so the user can fix a digit.
      if (isExpiredCodeError(error)) setCode("");
      return;
    }
    if (signIn.status === "complete") {
      await finalize();
    } else {
      // Verified without error but not complete — surface it instead of leaving
      // the user on a dead form (the silent stall this whole flow exists to fix).
      setFlowError("Couldn't complete sign in. Try again.");
    }
  };

  const handleResend = async () => {
    if (countdown > 0) return;
    setFlowError(null);
    try {
      await signIn.mfa.sendEmailCode();
      setCode("");
      setSendFailed(false);
      startTimer();
    } catch (err) {
      setFlowError(
        resolveClerkThrownError(
          err,
          "Couldn't resend the code. Try again in a moment.",
        ),
      );
    }
  };

  // Second-factor step: Client Trust wants an email code before finishing. Same
  // "check your email" affordance as sign-up so the OTP moment reads the same.
  if (verifying) {
    return (
      <AuthFrame
        title="Verify it's you."
        description={
          sendFailed
            ? "We couldn't send the code. Use resend to try again."
            : `New device, so we sent a 6-digit code to ${email}.`
        }
        footer={
          <AuthCrossButton onClick={handleResend} disabled={countdown > 0}>
            {countdown > 0 ? `resend code (${countdown})` : "resend code"}
          </AuthCrossButton>
        }
      >
        <form
          action={(formData) => verifyCode(String(formData.get("code") ?? ""))}
          className="flex flex-col gap-6"
        >
          <div className="flex flex-col gap-3">
            <AuthFieldLabel htmlFor="code">Verification code</AuthFieldLabel>
            <CodeField
              id="code"
              name="code"
              value={code}
              onValueChange={setCode}
              autoSubmit
              invalid={!!codeError}
              describedBy={codeError ? "code-error" : undefined}
              autoFocus
            />
            {codeError && (
              <AuthFieldError
                id="code-error"
                message={resolveClerkErrorMessage(codeError)}
              />
            )}
          </div>

          <AuthFormError messages={globalErrorMessages} />

          <AuthSubmitButton idleLabel="Verify" pendingLabel="Verifying" />
        </form>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      title="Sign in."
      description="Welcome back."
      footer={
        <AuthCrossLink href="/sign-up">
          new here? create account →
        </AuthCrossLink>
      }
    >
      <div className="flex flex-col gap-8">
        <OAuthButtons mode="sign-in" />

        <AuthDivider label="or email" />

        <form action={submit} className="flex flex-col gap-5">
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
              aria-invalid={identifierError ? true : undefined}
              aria-describedby={identifierError ? "email-error" : undefined}
            />
            {identifierError && (
              <AuthFieldError
                id="email-error"
                message={resolveClerkErrorMessage(
                  identifierError,
                  "email address",
                )}
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
              autoComplete="current-password"
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

          <AuthFormError messages={globalErrorMessages} />

          <AuthSubmitButton
            idleLabel="Sign in"
            pendingLabel="Signing in"
            className="mt-2"
          />
        </form>
      </div>
    </AuthFrame>
  );
}
