"use client";

import * as React from "react";
import { useSignIn } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/cubby-ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/cubby-ui/input-otp";
import { AuthFrame } from "./auth-frame";
import { OAuthButtons } from "./oauth-buttons";
import {
  AuthCrossButton,
  AuthCrossLink,
  AuthDivider,
  AuthFieldError,
  AuthFieldLabel,
  AuthFormError,
  AuthSubmitButton,
  getSafeRedirectUrl,
  resolveClerkErrorMessage,
  type ClerkErrorLike,
} from "./shared";

const RESEND_COOLDOWN_MS = 30_000;

export function SignInForm() {
  const { signIn, errors } = useSignIn();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  // Set once Clerk asks for the email code and we've sent it. Clerk's Client
  // Trust triggers a second factor on password sign-in from a new device even
  // for accounts without user-configured MFA — the emailed code proves it's
  // them. Without this branch the form silently stalled at that step.
  const [verifying, setVerifying] = React.useState(false);
  const [resendState, setResendState] = React.useState<
    "idle" | "sending" | "sent"
  >("idle");
  const [flowError, setFlowError] = React.useState<string | null>(null);
  const router = useRouter();

  const otpRef = React.useRef<HTMLInputElement>(null);
  const cooldownRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cache Components keeps this route mounted via React Activity on navigation,
  // which otherwise preserves input values and transient auth state between
  // visits. Clear everything when the route becomes hidden.
  React.useLayoutEffect(() => {
    return () => {
      setEmail("");
      setPassword("");
      setCode("");
      setVerifying(false);
      setResendState("idle");
      setFlowError(null);
      if (cooldownRef.current) {
        clearTimeout(cooldownRef.current);
        cooldownRef.current = null;
      }
    };
  }, []);

  const identifierError = errors?.fields?.identifier;
  const passwordError = errors?.fields?.password;
  const codeError = errors?.fields?.code;
  const globalErrorMessages = [
    ...(errors?.global?.map((e) => resolveClerkErrorMessage(e)) ?? []),
    ...(flowError ? [flowError] : []),
  ];

  const isCodeExpired =
    codeError?.code === "verification_expired" ||
    errors?.global?.some((e) => e.code === "verification_expired");

  React.useEffect(() => {
    if (isCodeExpired) setCode("");
  }, [isCodeExpired]);

  const finalizeSignIn = async () => {
    // Read redirect_url directly from window.location instead of via
    // useSearchParams. Cache Components forces any component that calls
    // useSearchParams to opt out of static prerendering, which would push the
    // auth flow into dynamic rendering on every request. This runs after
    // submit (client-side), so window is available and we avoid the prerender
    // penalty. Don't "fix" back to the hook without weighing the cache impact.
    const redirectUrl = getSafeRedirectUrl(
      new URLSearchParams(window.location.search).get("redirect_url"),
    );
    await signIn.finalize({
      navigate: ({ session, decorateUrl }) => {
        if (session?.currentTask) return;
        const url = decorateUrl(redirectUrl);
        if (url.startsWith("http")) {
          window.location.href = url;
        } else {
          router.push(url);
        }
      },
    });
  };

  const submit = async () => {
    setFlowError(null);
    const { error } = await signIn.password({
      identifier: email,
      password,
    });
    if (error) return;

    if (signIn.status === "complete") {
      await finalizeSignIn();
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
      } catch (err) {
        const first = (err as { errors?: ClerkErrorLike[] })?.errors?.[0];
        setFlowError(
          first
            ? resolveClerkErrorMessage(first)
            : "Couldn't send the verification code. Try again.",
        );
      }
      return;
    }

    // Any other non-complete status has no path in this app — surface it
    // rather than leaving the button looking like it did nothing.
    setFlowError("Couldn't complete sign in. Try again.");
  };

  const submitVerify = async () => {
    const { error } = await signIn.mfa.verifyEmailCode({ code });
    if (error) return;
    if (signIn.status === "complete") {
      await finalizeSignIn();
    }
  };

  const handleResend = async () => {
    if (resendState !== "idle") return;
    setResendState("sending");
    setFlowError(null);
    try {
      await signIn.mfa.sendEmailCode();
      setResendState("sent");
      setCode("");
      otpRef.current?.focus();
      if (cooldownRef.current) clearTimeout(cooldownRef.current);
      cooldownRef.current = setTimeout(
        () => setResendState("idle"),
        RESEND_COOLDOWN_MS,
      );
    } catch (err) {
      const first = (err as { errors?: ClerkErrorLike[] })?.errors?.[0];
      setFlowError(
        first
          ? resolveClerkErrorMessage(first)
          : "Couldn't resend the code. Try again in a moment.",
      );
      setResendState("idle");
    }
  };

  // Second-factor step: Client Trust wants an email code before finishing.
  // Same "check your email" affordance as sign-up so the OTP moment reads the
  // same across both flows.
  if (verifying) {
    const resendStatus =
      resendState === "sending"
        ? "sending…"
        : resendState === "sent"
          ? "code sent ✓"
          : null;

    return (
      <AuthFrame
        title="Verify it's you."
        description={`New device, so we sent a 6-digit code to ${email}.`}
        footer={
          <div className="flex items-center gap-3">
            {resendStatus ? <span role="status">{resendStatus}</span> : null}
            <AuthCrossButton
              onClick={handleResend}
              disabled={resendState !== "idle"}
            >
              resend code
            </AuthCrossButton>
          </div>
        }
      >
        <form action={submitVerify} className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <AuthFieldLabel htmlFor="code">Verification code</AuthFieldLabel>
            <InputOTP
              id="code"
              ref={otpRef}
              maxLength={6}
              value={code}
              onChange={setCode}
              autoFocus
              aria-invalid={codeError ? true : undefined}
              aria-describedby={codeError ? "code-error" : undefined}
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
              </InputOTPGroup>
              <InputOTPGroup>
                <InputOTPSlot index={1} />
              </InputOTPGroup>
              <InputOTPGroup>
                <InputOTPSlot index={2} />
              </InputOTPGroup>
              <InputOTPGroup>
                <InputOTPSlot index={3} />
              </InputOTPGroup>
              <InputOTPGroup>
                <InputOTPSlot index={4} />
              </InputOTPGroup>
              <InputOTPGroup>
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
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
