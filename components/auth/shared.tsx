"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { ViewIcon, ViewOffIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/cubby-ui/button";
import { Input } from "@/components/ui/cubby-ui/input";
import { Label } from "@/components/ui/cubby-ui/label";
import { cn } from "@/lib/utils";

/**
 * Validate the proxy-injected `redirect_url` query param is same-origin
 * before passing it to Clerk's auth flow. Prevents open-redirect / phishing
 * via crafted `?redirect_url=https://evil.com` links, while still honoring
 * the legitimate post-auth destination set by `auth.protect()` in the proxy.
 *
 * Returns just the path+search+hash so Clerk receives a relative URL.
 *
 * Client-only: relies on `window.location.origin`. The SSR guard prevents
 * a crash if a future caller pulls this into a render path on the server.
 */
export function getSafeRedirectUrl(raw: string | null): string {
  if (!raw) return "/";
  if (typeof window === "undefined") return "/";
  try {
    const parsed = new URL(raw, window.location.origin);
    if (parsed.origin !== window.location.origin) return "/";
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return "/";
  }
}

/**
 * Build the sign-in URL that returns the user to `redirectTo` afterward. The
 * one place this query string is assembled — the /sign-in page validates the
 * param with getSafeRedirectUrl above, so callers (paywall, star, fork-bundle)
 * don't hand-roll it.
 */
export function signInUrl(redirectTo: string): string {
  return `/sign-in?redirect_url=${encodeURIComponent(redirectTo)}`;
}

/**
 * The post-auth destination, shared by signIn.finalize and signUp.finalize.
 * Reads the proxy-injected redirect_url from window.location — NOT
 * useSearchParams, which would opt the auth route out of static prerendering
 * under Cache Components (this runs client-side after submit, so window is
 * available). Validates it same-origin via getSafeRedirectUrl and navigates.
 * Hoisted so the open-redirect boundary lives in exactly one place; callers keep
 * the `navigate` closure inline (Clerk infers its param types) and handle the
 * `session.currentTask` early-return there.
 */
export function navigateAfterAuth(
  router: { push: (href: string) => void },
  decorateUrl: (url: string) => string,
): void {
  const redirectUrl = getSafeRedirectUrl(
    new URLSearchParams(window.location.search).get("redirect_url"),
  );
  const url = decorateUrl(redirectUrl);
  if (url.startsWith("http")) {
    window.location.href = url;
  } else {
    router.push(url);
  }
}

/**
 * True when a Clerk verify error means the code expired (as opposed to a wrong
 * code). Callers clear the input on expiry so a fresh resend starts clean, but
 * keep a mistyped code so the user can fix a digit.
 */
export function isExpiredCodeError(err: unknown): boolean {
  const e = err as ClerkErrorLike | undefined;
  return (
    e?.code === "verification_expired" ||
    (e?.errors?.some((x) => x?.code === "verification_expired") ?? false)
  );
}

/**
 * Field label for the auth forms. No override any more: this used to force
 * 10px mono uppercase muted, which shrank "Verification code" to the smallest
 * type on a page whose only job is that field. The Label default (14px sans,
 * medium, full-strength) is the right treatment, and matching it keeps the auth
 * forms in the same vocabulary as every other form in the product.
 */
export function AuthFieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>) {
  return <Label className={className} {...props} />;
}

export function AuthArrowRight({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn("size-4", className)}
      aria-hidden="true"
      fill="none"
    >
      <path
        d="M3 8h10m0 0L9 4m4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="square"
      />
    </svg>
  );
}

export function AuthDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <span className="h-px flex-1 bg-border" />
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * The cross-links live in the card's tray band (`AuthFrame`'s footer), where
 * they are the only interactive thing — so they read at full foreground
 * strength beside muted prose rather than as muted-until-hover text.
 *
 * `py-2` and `-my-2` are a pair and neither is decoration. This is an
 * inline-block, so its MARGIN box is what contributes to the line box: the
 * padding grows the clickable box to 36px, and the negative margin subtracts
 * exactly that back out so the band stays one line tall. Measured — dropping
 * the margin takes the paragraph 20px → 36px and the footer 38px → 54px;
 * dropping the padding collapses the target to the 20px line box.
 */
const crossLinkClass =
  "text-foreground focus-visible:outline-ring/60 -my-2 inline-block rounded-sm py-2 font-medium underline-offset-4 transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50";

export function AuthCrossLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={crossLinkClass}>
      {children}
    </Link>
  );
}

type AuthCrossButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export function AuthCrossButton({
  className,
  type = "button",
  ...props
}: AuthCrossButtonProps) {
  return (
    <button type={type} className={cn(crossLinkClass, className)} {...props} />
  );
}

/**
 * Password input with a reveal toggle, the one place the auth forms deviate
 * from a bare `Input`.
 *
 * `variant="elevated"` throughout the auth forms: the opaque `bg-input` default
 * is the same value as `surface-3`, so on the card's raised well every field
 * would vanish into its own container.
 *
 * The toggle is `aria-pressed` rather than a label that flips meaning, and it
 * sits outside the input's padding box (`pr-10`) so a long password never runs
 * under it.
 */
export function AuthPasswordField({
  id,
  value,
  onChange,
  autoComplete,
  invalid,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  invalid?: boolean;
  describedBy?: string;
}) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        variant="elevated"
        className="pr-10"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        autoComplete={autoComplete}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label="Show password"
        aria-pressed={visible}
        aria-controls={id}
        className="absolute inset-y-0 right-0 flex w-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors duration-100 ease-out hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/60"
      >
        <HugeiconsIcon
          icon={visible ? ViewOffIcon : ViewIcon}
          className="size-4"
        />
      </button>
    </div>
  );
}

export function AuthSubmitButton({
  idleLabel,
  pendingLabel,
  className,
}: {
  idleLabel: string;
  pendingLabel: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="neutral"
      loading={pending}
      trailingIcon={<AuthArrowRight />}
      className={cn("w-full", className)}
    >
      {pending ? pendingLabel : idleLabel}
    </Button>
  );
}

export type ClerkErrorLike = {
  code?: string;
  message?: string;
  longMessage?: string;
  // Present on ClerkAPIResponseError wrappers from `errors.global`.
  errors?: ReadonlyArray<{
    code?: string;
    message?: string;
    longMessage?: string;
  }>;
};

// Override Clerk's copy for specific error codes. Add an entry only when
// Clerk's `message` AND `longMessage` are both poor. `resolveClerkErrorMessage`
// already falls back to `longMessage ?? message`, so most codes need no help.
// Confirmed against Clerk's Frontend API error reference.
const CLERK_ERROR_OVERRIDES: Record<string, string> = {
  // Clerk: message="is incorrect", longMessage="Incorrect code" — the
  // longMessage is fine, but adding a "Please try again." softens it.
  form_code_incorrect: "Incorrect code. Please try again.",
  // Clerk: message="Rate limit exceeded", longMessage missing.
  rate_limit_exceeded: "Too many attempts. Wait a bit and try again.",
  // Clerk's Frontend API emits this code for user-facing rate limits.
  too_many_requests: "Too many attempts. Wait a bit and try again.",
};

export function resolveClerkErrorMessage(
  err: ClerkErrorLike,
  fieldLabel?: string,
): string {
  // Errors in `errors.global` are ClerkAPIResponseError wrappers that carry
  // the real error(s) in a nested `.errors` array. Unwrap if present.
  const effective = err.errors?.[0] ?? err;

  if (effective.code && CLERK_ERROR_OVERRIDES[effective.code]) {
    return CLERK_ERROR_OVERRIDES[effective.code];
  }
  // `form_param_format_invalid` is generic (email, phone, wallet, …).
  // If the caller knows the field's user-facing label, use it.
  if (effective.code === "form_param_format_invalid" && fieldLabel) {
    return `Enter a valid ${fieldLabel}.`;
  }
  // `||` rather than `??` — Clerk sometimes returns `longMessage: ""`.
  return effective.longMessage || effective.message || "";
}

export function AuthFormError({ messages }: { messages: string[] }) {
  // De-dupe: a failed Clerk action surfaces its error through both the hook's
  // `errors.global` and any message we set ourselves (flowError / resendError),
  // which resolve to the same string. Show it once.
  const visible = Array.from(
    new Set(messages.map((m) => m.trim()).filter((m) => m.length > 0)),
  );
  if (visible.length === 0) return null;
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {visible.length === 1 ? (
        visible[0]
      ) : (
        <ul className="list-inside list-disc space-y-1">
          {visible.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AuthFieldError({
  id,
  message,
}: {
  id: string;
  message: string;
}) {
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}
