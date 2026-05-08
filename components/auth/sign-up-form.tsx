"use client";

import * as React from "react";
import { useSignUp, useAuth } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
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

export function SignUpForm() {
  const { signUp, errors } = useSignUp();
  const { isSignedIn } = useAuth();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [resendState, setResendState] = React.useState<
    "idle" | "sending" | "sent"
  >("idle");
  const [resendError, setResendError] = React.useState<string | null>(null);
  const [advancedToVerify, setAdvancedToVerify] = React.useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  const emailError = errors?.fields?.emailAddress;
  const passwordError = errors?.fields?.password;
  const codeError = errors?.fields?.code;
  const captchaError = errors?.fields?.captcha;
  const globalErrorMessages = [
    ...(errors?.global?.map((e) => resolveClerkErrorMessage(e)) ?? []),
    ...(captchaError ? [resolveClerkErrorMessage(captchaError)] : []),
    ...(resendError ? [resendError] : []),
  ];

  const otpRef = React.useRef<HTMLInputElement>(null);
  const cooldownRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cache Components keeps this route mounted via React Activity on
  // navigation, which otherwise preserves form input values and transient
  // auth state between visits. Reset everything when the route becomes hidden
  // so returning to it is a fresh experience.
  React.useLayoutEffect(() => {
    return () => {
      setEmail("");
      setPassword("");
      setCode("");
      setAdvancedToVerify(false);
      setResendState("idle");
      setResendError(null);
      if (cooldownRef.current) {
        clearTimeout(cooldownRef.current);
        cooldownRef.current = null;
      }
    };
  }, []);

  const isCodeExpired =
    codeError?.code === "verification_expired" ||
    errors?.global?.some((e) => e.code === "verification_expired");

  React.useEffect(() => {
    if (isCodeExpired) setCode("");
  }, [isCodeExpired]);

  const submitSignUp = async () => {
    const { error } = await signUp.password({
      emailAddress: email,
      password,
    });
    if (error) return;

    try {
      await signUp.verifications.sendEmailCode();
      setAdvancedToVerify(true);
    } catch (err) {
      // Account was created but the code wasn't sent. Don't advance —
      // surface the failure so the user knows to retry.
      const first = (err as { errors?: ClerkErrorLike[] })?.errors?.[0];
      setResendError(
        first
          ? resolveClerkErrorMessage(first)
          : "Couldn't send the verification code. Try again.",
      );
    }
  };

  const submitVerify = async () => {
    await signUp.verifications.verifyEmailCode({ code });

    if (signUp.status === "complete") {
      const redirectUrl = getSafeRedirectUrl(searchParams.get("redirect_url"));
      await signUp.finalize({
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
    }
  };

  const handleResend = async () => {
    if (resendState !== "idle") return;
    setResendState("sending");
    setResendError(null);
    try {
      await signUp.verifications.sendEmailCode();
      setResendState("sent");
      setCode("");
      otpRef.current?.focus();
      if (cooldownRef.current) clearTimeout(cooldownRef.current);
      cooldownRef.current = setTimeout(
        () => setResendState("idle"),
        RESEND_COOLDOWN_MS,
      );
    } catch (err) {
      const clerkErrors = (err as { errors?: ClerkErrorLike[] })?.errors;
      const first = clerkErrors?.[0];
      setResendError(
        first
          ? resolveClerkErrorMessage(first)
          : "Couldn't resend the code. Try again in a moment.",
      );
      setResendState("idle");
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
    const resendStatus =
      resendState === "sending"
        ? "sending…"
        : resendState === "sent"
          ? "code sent ✓"
          : null;

    return (
      <AuthFrame
        title="Check your email."
        description={`We sent a 6-digit code to ${email}.`}
        footer={
          isVerifyComplete ? null : (
            <div className="flex items-center gap-3">
              {resendStatus ? <span role="status">{resendStatus}</span> : null}
              <AuthCrossButton
                onClick={handleResend}
                disabled={resendState !== "idle"}
              >
                resend code
              </AuthCrossButton>
            </div>
          )
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
              autoFocus={!isVerifyComplete}
              disabled={isVerifyComplete}
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
