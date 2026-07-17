"use client";

import {
  OTPField,
  OTPFieldInput,
} from "@/components/ui/cubby-ui/otp-field/otp-field";

const CODE_LENGTH = 6;

/**
 * The one 6-digit code input every auth flow shares (sign-up, sign-in's second
 * factor, and the two settings verification surfaces). Built on the cubby
 * `otp-field` primitive so the slots, focus/paste handling, numeric validation,
 * and invalid styling live in one place instead of a hand-pasted slot ladder.
 *
 * Two completion modes: form surfaces (sign-up, sign-in) pass `name` +
 * `autoSubmit` so completion submits the owning `<form>` — the action reads the
 * code from FormData, which keeps useFormStatus pending accurate and gives a
 * single entry path (no concurrent manual + auto verify). Non-form surfaces (the
 * settings dialogs) pass `onComplete`, which fires with the value directly. The
 * transport (which Clerk call sends/verifies the code) stays with each caller.
 */
export function CodeField({
  id,
  name,
  value,
  onValueChange,
  onComplete,
  autoSubmit,
  disabled,
  invalid,
  autoFocus,
  variant = "default",
  describedBy,
}: {
  /** Sets the first input's id so a `<label htmlFor>` can target the field. */
  id?: string;
  /** Names the hidden value input so a form action can read it from FormData. */
  name?: string;
  value: string;
  onValueChange: (value: string) => void;
  /** Fires with the complete code once all slots fill (non-form auto-submit). */
  onComplete?: (value: string) => void;
  /** Submit the owning `<form>` when the code completes (form surfaces). */
  autoSubmit?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  /** `elevated` for use inside a Card/Dialog surface. */
  variant?: "default" | "elevated";
  describedBy?: string;
}) {
  return (
    <OTPField
      id={id}
      name={name}
      length={CODE_LENGTH}
      value={value}
      onValueChange={(next) => onValueChange(next)}
      onValueComplete={onComplete ? (next) => onComplete(next) : undefined}
      autoSubmit={autoSubmit}
      disabled={disabled}
    >
      {Array.from({ length: CODE_LENGTH }, (_, i) => (
        <OTPFieldInput
          key={i}
          variant={variant}
          autoFocus={autoFocus && i === 0 ? true : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={i === 0 ? describedBy : undefined}
          aria-label={`Digit ${i + 1} of ${CODE_LENGTH}`}
        />
      ))}
    </OTPField>
  );
}
