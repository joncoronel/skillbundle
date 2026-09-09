"use client";

import * as React from "react";
import { useSignIn } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/cubby-ui/input";
import {
  TransitionPanel,
  TransitionPanelView,
} from "@/components/ui/cubby-ui/transition-panel";
import { useResendTimer } from "@/hooks/use-resend-timer";
import { track } from "@/lib/analytics";
import { AuthFrame, AuthStepHeader } from "./auth-frame";
import {
  AuthCodeGroup,
  AuthCrossButton,
  AuthCrossLink,
  AuthFieldError,
  AuthFieldLabel,
  AuthFooterPrompt,
  AuthFormError,
  AuthPasswordField,
  AuthSubmitButton,
  isExpiredCodeError,
  navigateAfterAuth,
  resolveClerkErrorMessage,
} from "./shared";

/**
 * Password reset: email, emailed code, new password.
 *
 * ── Why this is its own route and not a branch of the sign-in form ────────
 *
 * `sign-in-form.tsx` already carries a password step and a Client Trust
 * second-factor step and is the largest file in this directory. A third and
 * fourth branch inside it would have made the file the flow rather than the
 * form. Recovery is also a genuinely separate errand: you arrive at it having
 * already failed at signing in, and being able to link straight to it matters.
 *
 * ── The Clerk API, verified against the installed package ─────────────────
 *
 * All four calls are on the same `useSignIn()` actions surface the other forms
 * use (`@clerk/shared@4.27.1`, `dist/types/signInFuture.d.ts:451-470`):
 *
 *   1. `signIn.create({ identifier })`
 *   2. `signIn.resetPasswordEmailCode.sendCode()`
 *   3. `resetPasswordEmailCode.verifyCode({ code })` → `'needs_new_password'`
 *   4. `resetPasswordEmailCode.submitPassword({ password })` → `'complete'`
 *
 * **There is no `signIn.resetPasswordMfa`.** A note in TODO.md said there was,
 * citing `signInFuture.d.ts:470` — that line is the closing brace of
 * `resetPasswordEmailCode`. The only `resetPasswordMfa` in the package is a key
 * in `localization.d.ts`, which types the strings for Clerk's PREBUILT
 * components and has no runtime surface here. So the post-reset second factor
 * is handled through the ordinary `signIn.mfa` surface, exactly as
 * `sign-in-form.tsx` handles Client Trust, in `SecondFactorStep` below.
 *
 * ── Motion ───────────────────────────────────────────────────────────────
 *
 * `TransitionPanel` in `slide` mode: forward steps enter from the right, a
 * corrected email slides back from the left, and the card's height animates
 * between steps rather than jumping. It also owns focus-on-swap and the
 * reduced-motion path.
 *
 * Everything moves as ONE unit — the step's heading travels with its form,
 * which is why `AuthFrame` is given no `title` here and each view renders its
 * own `AuthStepHeader`. Only the logo badge stays fixed, as the anchor the
 * content moves under. Nothing inside a view animates on its own: one entrance
 * per container, so the fields are simply present when the step arrives.
 *
 * This flow is rare enough to afford that. Do not copy the pattern onto
 * sign-in, which people do constantly and which should stay instant.
 *
 * ── Why all three views stay mounted, and what it forbids ─────────────────
 *
 * `TransitionPanel` keeps every view in the DOM and marks the inactive ones
 * `inert` + `aria-hidden`. That is why the second-factor step is NOT a fourth
 * view: `AuthCodeGroup` hard-codes `id="code"`, so a second code step as a
 * sibling would put a duplicate id in the document. It renders as its own
 * terminal frame instead — the same shape `sign-in-form.tsx` uses, and a path
 * reached only by an account with a second factor on a new device.
 */

type Step = "email" | "code" | "password";

const STEP_ORDER: Step[] = ["email", "code", "password"];

export function ResetPasswordForm() {
  const { signIn, errors } = useSignIn();
  const router = useRouter();

  const [step, setStep] = React.useState<Step>("email");
  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [flowError, setFlowError] = React.useState<string | null>(null);
  // Set when we land on the code step without a code actually having been sent,
  // so the heading doesn't claim "we sent a code". Mirrors sign-in-form.
  const [sendFailed, setSendFailed] = React.useState(false);
  // The reset succeeded but Clerk wants a second factor before it will finish.
  const [needsSecondFactor, setNeedsSecondFactor] = React.useState(false);
  // Drives the polite live region. A successful resend silently wipes the typed
  // digits and disables the button, so a non-sighted user got no signal that
  // anything happened, only a field that emptied itself. Counted rather than
  // stored as a string so repeat resends each announce; see `handleResend`.
  const [resendCount, setResendCount] = React.useState(0);
  const { countdown, startTimer, resetTimer } = useResendTimer();

  // Cache Components keeps this route mounted via React Activity, so state
  // survives navigating away and back. Clear it on hide — the password matters
  // most here, but a half-finished reset returning mid-flow is wrong too.
  React.useLayoutEffect(() => {
    return () => {
      setStep("email");
      setEmail("");
      setCode("");
      setPassword("");
      setFlowError(null);
      setSendFailed(false);
      setNeedsSecondFactor(false);
      setResendCount(0);
      resetTimer();
    };
  }, [resetTimer]);

  const identifierError = errors?.fields?.identifier;
  const codeError = errors?.fields?.code;
  const passwordError = errors?.fields?.password;
  const globalErrorMessages = [
    ...(errors?.global?.map((e) => resolveClerkErrorMessage(e)) ?? []),
    ...(flowError ? [flowError] : []),
  ];

  /** Moving between steps always clears the previous step's flow error. */
  const goTo = (next: Step) => {
    setFlowError(null);
    setStep(next);
  };

  const sendCode = async () => {
    const { error } = await signIn.resetPasswordEmailCode.sendCode();
    if (error) {
      // Advance anyway rather than stranding the user on the email step, whose
      // only button would re-run a `create` that already succeeded. The code
      // step's resend is the retry, so leave the cooldown off and say plainly
      // that nothing was sent.
      setSendFailed(true);
      setFlowError(
        resolveClerkErrorMessage(error) ||
          "Couldn't send the code. Use resend to try again.",
      );
      return;
    }
    setSendFailed(false);
    startTimer();
  };

  const submitEmail = async () => {
    setFlowError(null);
    setSendFailed(false);

    // `create` establishes the sign-in attempt the reset runs against. Deliberately
    // NOT passing a strategy: the identifier alone is what this step has.
    const { error } = await signIn.create({ identifier: email });
    if (error) return;

    // Both branches land on the code step — see the note in `sendCode`.
    setStep("code");
    await sendCode();
  };

  const verifyCode = async (value: string) => {
    setFlowError(null);
    const { error } = await signIn.resetPasswordEmailCode.verifyCode({
      code: value,
    });
    if (error) {
      // Expired → clear so a resend starts clean. A wrong code stays put so the
      // user can fix one digit rather than retyping six.
      if (isExpiredCodeError(error)) setCode("");
      return;
    }

    if (signIn.status === "needs_new_password") {
      goTo("password");
      return;
    }
    // Verified without an error but not where we expect. Say so rather than
    // leaving a form that looks fine and does nothing.
    setFlowError("Couldn't verify that code. Try again.");
  };

  const submitPassword = async () => {
    setFlowError(null);
    const { error } = await signIn.resetPasswordEmailCode.submitPassword({
      password,
      // The security-correct default after a reset: whoever else was signed in
      // as you no longer is. Stated in the step's copy rather than offered as a
      // checkbox, because "should I?" is not a question this screen should ask
      // someone who is already locked out.
      signOutOfOtherSessions: true,
    });
    if (error) return;

    if (signIn.status === "complete") {
      track("password_reset_completed");
      await finalize();
      return;
    }

    // The password is already changed at this point — only the SESSION is
    // incomplete. So every branch below has to keep saying that, or the user
    // reads a failure and resets again.
    const emailFactor = signIn.supportedSecondFactors?.find(
      (factor) => factor.strategy === "email_code",
    );
    if (!emailFactor) {
      setFlowError(
        "Your password is changed, but we couldn't finish signing you in here. Try signing in with it.",
      );
      return;
    }

    setNeedsSecondFactor(true);
    setCode("");
    const { error: sendError } = await signIn.mfa.sendEmailCode();
    if (sendError) {
      setSendFailed(true);
      setFlowError(
        resolveClerkErrorMessage(sendError) ||
          "Couldn't send the code. Use resend to try again.",
      );
      return;
    }
    setSendFailed(false);
    startTimer();
  };

  const finalize = async () => {
    await signIn.finalize({
      navigate: ({ session, decorateUrl }) => {
        if (session?.currentTask) return;
        navigateAfterAuth(router, decorateUrl);
      },
    });
  };

  const handleResend = async () => {
    if (countdown > 0) return;
    setFlowError(null);
    // Two different codes are in play across this flow, and resending the wrong
    // one silently invalidates the one the user is holding.
    const { error } = needsSecondFactor
      ? await signIn.mfa.sendEmailCode()
      : await signIn.resetPasswordEmailCode.sendCode();
    if (error) {
      // Keep the cooldown off and any typed digits intact so the user can retry
      // now. Don't touch `sendFailed`: if the first send worked, an earlier code
      // is still valid and "we sent a code" is still true.
      setFlowError(
        resolveClerkErrorMessage(error) ||
          "Couldn't resend the code. Try again in a moment.",
      );
      return;
    }
    setCode("");
    setSendFailed(false);
    // Counter-suffixed, and that is the whole reason it exists. A live region
    // announces on CHANGE, so setting the same string twice is a no-op in React
    // and the second resend was silent. The count is the announcement's own
    // ordinal, which is also the more useful thing to hear.
    setResendCount((n) => n + 1);
    startTimer();
  };

  // Terminal step, outside the animated panel — see the header note on ids.
  if (needsSecondFactor) {
    return (
      <SecondFactorStep
        email={email}
        code={code}
        onCodeChange={setCode}
        sendFailed={sendFailed}
        codeErrorMessage={
          codeError ? resolveClerkErrorMessage(codeError) : undefined
        }
        globalErrorMessages={globalErrorMessages}
        countdown={countdown}
        onResend={handleResend}
        resendCount={resendCount}
        onVerify={async (value) => {
          setFlowError(null);
          const { error } = await signIn.mfa.verifyEmailCode({ code: value });
          if (error) {
            if (isExpiredCodeError(error)) setCode("");
            return;
          }
          if (signIn.status === "complete") {
            track("password_reset_completed");
            await finalize();
          } else {
            setFlowError("Couldn't complete sign in. Try again.");
          }
        }}
      />
    );
  }

  return (
    <AuthFrame
      footer={
        <ResetFooter
          step={step}
          countdown={countdown}
          onResend={handleResend}
          resendCount={resendCount}
        />
      }
    >
      <TransitionPanel
        activeKey={step}
        // The panel is `overflow-clip`, and every focusable thing in these
        // views (inputs, the submit button) is full-width, so it sits flush
        // with the clip edge and its focus ring was being sheared off at the
        // left and right. 4px is not a guess: the ring is
        // `outline-offset-2` + `outline-2` on both `Input` and `Button`, so it
        // extends exactly 4px past the border box.
        //
        // `--tp-clip-margin` is the component's own documented escape hatch for
        // this ("bump it when view content sits flush with a padded container's
        // edge"). Do NOT fix it by shrinking the focus ring — DESIGN.md already
        // records that these rings sit below the 3:1 contrast threshold, so
        // making them smaller too is the wrong direction.
        style={{ "--tp-clip-margin": "4px" } as React.CSSProperties}
      >
        {STEP_ORDER.map((key) => (
          <TransitionPanelView key={key} viewKey={key}>
            {key === "email" ? (
              <>
                <AuthStepHeader
                  title="Reset your password."
                  description="Enter your email and we'll send you a code."
                />
                <form action={submitEmail} className="mt-8 flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <AuthFieldLabel htmlFor="reset-email">Email</AuthFieldLabel>
                    <Input
                      id="reset-email"
                      type="email"
                      variant="elevated"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      aria-invalid={identifierError ? true : undefined}
                      aria-describedby={
                        identifierError ? "reset-email-error" : undefined
                      }
                    />
                    {identifierError && (
                      <AuthFieldError
                        id="reset-email-error"
                        message={resolveClerkErrorMessage(
                          identifierError,
                          "email address",
                        )}
                      />
                    )}
                  </div>

                  <AuthFormError messages={globalErrorMessages} />

                  <AuthSubmitButton
                    idleLabel="Send code"
                    pendingLabel="Sending"
                    className="mt-2"
                  />
                </form>
              </>
            ) : key === "code" ? (
              <>
                <AuthStepHeader
                  title="Check your email."
                  description={
                    sendFailed
                      ? "We couldn't send the code. Use resend to try again."
                      : `We sent a 6-digit code to ${email}.`
                  }
                />
                <form
                  action={(formData) =>
                    verifyCode(String(formData.get("code") ?? ""))
                  }
                  className="mt-8 flex flex-col gap-6"
                >
                  <AuthCodeGroup
                    value={code}
                    onValueChange={setCode}
                    autoSubmit
                    invalid={!!codeError}
                    errorMessage={
                      codeError
                        ? resolveClerkErrorMessage(codeError)
                        : undefined
                    }
                  />

                  <AuthFormError messages={globalErrorMessages} />

                  <AuthSubmitButton
                    idleLabel="Verify"
                    pendingLabel="Verifying"
                  />
                </form>
              </>
            ) : (
              <>
                <AuthStepHeader
                  title="Choose a new password."
                  description="You'll be signed in here and signed out everywhere else."
                />
                <form
                  action={submitPassword}
                  className="mt-8 flex flex-col gap-4"
                >
                  <div className="flex flex-col gap-2">
                    <AuthFieldLabel htmlFor="new-password">
                      New password
                    </AuthFieldLabel>
                    <AuthPasswordField
                      id="new-password"
                      value={password}
                      onChange={setPassword}
                      autoComplete="new-password"
                      invalid={!!passwordError}
                      describedBy={
                        passwordError ? "new-password-error" : undefined
                      }
                    />
                    {/* Clerk owns the password policy (length, breach checks,
                        complexity) in its dashboard, so the rules are NOT
                        restated here — a second copy would drift the moment the
                        policy changed. A rejected password comes back as this
                        field error, already carrying the specific reason. */}
                    {passwordError && (
                      <AuthFieldError
                        id="new-password-error"
                        message={resolveClerkErrorMessage(passwordError)}
                      />
                    )}
                  </div>

                  <AuthFormError messages={globalErrorMessages} />

                  <AuthSubmitButton
                    idleLabel="Reset password"
                    pendingLabel="Resetting"
                    className="mt-2"
                  />
                </form>
              </>
            )}
          </TransitionPanelView>
        ))}
      </TransitionPanel>
    </AuthFrame>
  );
}

/**
 * The "didn't get it? resend" footer, shared by the code step and the
 * second-factor step. It existed twice with the same countdown label and
 * disabled rule, which is how those two steps drift apart.
 *
 * `aria-disabled` rather than `disabled` during the cooldown: several screen
 * readers drop a genuinely disabled control from the tree, so a non-sighted
 * user who pressed Resend lost the button and got no explanation. It stays
 * focusable and announced, and the handler no-ops while the timer runs (it
 * already guards on `countdown > 0`).
 */
function ResendPrompt({
  countdown,
  onResend,
  resendCount,
}: {
  countdown: number;
  onResend: () => void;
  resendCount: number;
}) {
  const cooling = countdown > 0;
  return (
    <AuthFooterPrompt prompt="Didn't get it?">
      {/* Visually redundant (the countdown already shows), so it is sr-only.
          `polite` so it waits for a pause rather than interrupting. */}
      <span role="status" aria-live="polite" className="sr-only">
        {resendCount > 0
          ? `New code sent. The code field has been cleared. (${resendCount})`
          : ""}
      </span>
      <AuthCrossButton
        onClick={onResend}
        aria-disabled={cooling || undefined}
        className={cooling ? "opacity-50" : undefined}
      >
        {cooling ? `Resend code (${countdown})` : "Resend code"}
      </AuthCrossButton>
    </AuthFooterPrompt>
  );
}

/**
 * The footer swaps content but never shape: a prompt plus one action, on one
 * line, at every step. It sits outside the panel (it is `CardFooter`, below the
 * card's inner surface) so it changes without sliding — which only reads right
 * because the shape holds still.
 */
function ResetFooter({
  step,
  countdown,
  onResend,
  resendCount,
}: {
  step: Step;
  countdown: number;
  onResend: () => void;
  resendCount: number;
}) {
  if (step === "code") {
    return (
      <ResendPrompt
        countdown={countdown}
        onResend={onResend}
        resendCount={resendCount}
      />
    );
  }
  return (
    <AuthFooterPrompt prompt="Remembered it?">
      <AuthCrossLink href="/sign-in">Back to sign in</AuthCrossLink>
    </AuthFooterPrompt>
  );
}

/**
 * The second factor Clerk can ask for AFTER the password is already changed.
 *
 * Its copy leads with "your password is set" on purpose: arriving at another
 * code field otherwise reads as the reset having failed, and the user's next
 * move is to start over with a password that is already live.
 */
function SecondFactorStep({
  email,
  code,
  onCodeChange,
  sendFailed,
  codeErrorMessage,
  globalErrorMessages,
  countdown,
  onResend,
  resendCount,
  onVerify,
}: {
  email: string;
  code: string;
  onCodeChange: (value: string) => void;
  sendFailed: boolean;
  codeErrorMessage?: string;
  globalErrorMessages: string[];
  countdown: number;
  onResend: () => void;
  resendCount: number;
  onVerify: (value: string) => void;
}) {
  return (
    <AuthFrame
      title="One more code."
      description={
        sendFailed
          ? "Your password is set. We couldn't send the code to finish signing you in. Use resend."
          : `Your password is set. This is a new device, so we sent a code to ${email} to finish signing you in.`
      }
      footer={
        <ResendPrompt
          countdown={countdown}
          onResend={onResend}
          resendCount={resendCount}
        />
      }
    >
      <form
        action={(formData) => onVerify(String(formData.get("code") ?? ""))}
        className="flex flex-col gap-6"
      >
        <AuthCodeGroup
          value={code}
          onValueChange={onCodeChange}
          autoSubmit
          autoFocus
          invalid={!!codeErrorMessage}
          errorMessage={codeErrorMessage}
        />

        <AuthFormError messages={globalErrorMessages} />

        <AuthSubmitButton idleLabel="Verify" pendingLabel="Verifying" />
      </form>
    </AuthFrame>
  );
}
