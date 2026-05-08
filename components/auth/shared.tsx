"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Button } from "@/components/ui/cubby-ui/button";
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

export function AuthFieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>) {
  return (
    <Label
      className={cn(
        "font-mono text-label uppercase tracking-eyebrow text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
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
    <div className="flex items-center gap-4" aria-hidden="true">
      <span className="h-px flex-1 bg-border" />
      <span className="font-mono text-label uppercase tracking-eyebrow text-muted-foreground">
        {label}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

const crossLinkClass =
  "-my-2 inline-flex items-center py-2 underline-offset-[6px] transition-colors hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-50";

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
      size="lg"
      loading={pending}
      rightSection={<AuthArrowRight />}
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
  const visible = messages.filter((m) => m.trim().length > 0);
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
