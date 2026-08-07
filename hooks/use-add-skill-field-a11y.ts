"use client";

/**
 * The accessibility contract shared by the add-skill surfaces.
 *
 * `/add` (components/add-skill/add-skill-flow.tsx) and the admin form
 * (app/(main)/dev/add-skill/add-skill-form.tsx) share their state machine
 * (`useAddSkillFlow`) and their copy helpers, but each writes its own markup —
 * different labels, layout, blocked reasons, and a signed-out branch only one of
 * them has. That divergence is fine and is why there is no shared
 * `<AddSkillField>` component: absorbing it would take about eight props, and a
 * component that is mostly props is worse than the duplication it replaces.
 *
 * What is NOT fine is that the a11y decisions were duplicated too, because those
 * must move together. Every one below has been corrected twice in a week, and the
 * fork is what made it twice — the admin input kept `disabled` long after the
 * public one switched to `readOnly`, which silently defeated every `focusInput()`
 * call in that file.
 *
 *   1. The input is `readOnly` while a request is in flight, never `disabled` — a
 *      disabled element cannot hold focus, so the browser drops it to `<body>`
 *      for the length of the request, and one submit can be three round trips.
 *   2. Any button that goes unavailable while working is `focusableWhenDisabled`,
 *      for the same reason. `busyButtonProps` carries this to the plain ones.
 *   3. UNCONDITIONALLY so — see `submitProps`.
 *   4. `aria-busy` keys off the IN-FLIGHT boolean, never the blocked one: a button
 *      blocked because the field is empty is not busy.
 *   5. A disabled button that is still a tab stop must say why, which is what
 *      `reasonProps` is for.
 *
 * This module owns the contract and returns props. Each surface keeps its own
 * markup and spreads them; nothing here renders.
 */
import { useId } from "react";
import type { ComponentProps } from "react";
import type { Button } from "@/components/ui/cubby-ui/button";
import type { Input } from "@/components/ui/cubby-ui/input";

type ButtonA11y = Pick<
  ComponentProps<typeof Button>,
  "disabled" | "focusableWhenDisabled" | "aria-busy" | "aria-describedby"
>;

/**
 * For any button that goes unavailable while work is in flight — its own, or a
 * sibling's.
 *
 * Applied at eight sites: the two submits (through `submitProps`), two card
 * Confirms, two card Cancels and two audit controls. Only the submits also need a
 * reason, which is what `useAddSkillFieldA11y` layers on top; splitting it this
 * way lets the other six share the rule without inventing a `reasonText` they have
 * no use for.
 *
 * `inFlight` is deliberately NOT the same thing as `disabled`, and the two cases
 * where they part are the reason this takes a parameter at all:
 *
 *   - a card's Cancel is unavailable because CONFIRM is working, so it passes
 *     `false` — focusable for the same reason, but it is not itself busy;
 *   - the audit's next-page button is disabled when the walk is exhausted, and
 *     finished is not busy either.
 */
export function busyButtonProps({
  inFlight,
}: {
  inFlight: boolean;
}): Pick<ButtonA11y, "focusableWhenDisabled" | "aria-busy"> {
  return { focusableWhenDisabled: true, "aria-busy": inFlight };
}

export function useAddSkillFieldA11y({
  pending,
  blocked,
  reasonText,
}: {
  /** A request is in flight. Drives `readOnly` and `aria-busy`. */
  pending: boolean;
  /**
   * Every reason the button is unavailable, not just `pending`. The hook now
   * emits `disabled` from this, so the caller states it once — previously both
   * sides wrote the same expression and only one of them fed
   * `aria-describedby`, which is how a blocked button could end up pointing at a
   * description that was never rendered.
   */
  blocked: boolean;
  /**
   * What to tell someone who tabs onto the disabled button — the caller's words,
   * since the two surfaces accept different input formats and rank their blocking
   * reasons differently. Ignored while `pending`, where the button's own label is
   * already the progress signal.
   */
  reasonText: string | null;
}) {
  // Only describe a genuinely blocked control. A description on a working button
  // reads as a warning about something wrong with it.
  const reason = blocked && !pending ? reasonText : null;
  // `useId`, not a caller-supplied prefix: the collision that can actually happen
  // is two `AddSkillFlow` instances on one page, and any prefix they passed would
  // be the same string. A caller-supplied one could not have prevented it.
  const reasonId = useId();

  return {
    /**
     * Spread onto the text input.
     *
     * `readOnly`, not `disabled` — see the module header. `autoComplete` off
     * because a password manager overlay on a non-auth field is noise, and
     * `spellCheck` off because `owner/repo/slug` is not prose. The caller still
     * owns `value`, `onChange`, `placeholder`, `autoFocus`, and its own
     * `aria-describedby`, which differs per surface.
     */
    inputProps: {
      readOnly: pending,
      autoComplete: "off",
      spellCheck: false,
    } satisfies Pick<
      ComponentProps<typeof Input>,
      "readOnly" | "autoComplete" | "spellCheck"
    >,

    /**
     * Spread onto the submit button. Carries `disabled` itself, so do not also
     * write one — a second attribute would be the fork this module exists to
     * close.
     *
     * ORDERING: `Button` still defaults `focusableWhenDisabled` to its own
     * `loading` prop, but it no longer relies on spread order to let a caller
     * win — it destructures the prop and writes
     * `focusableWhenDisabled={focusableWhenDisabled ?? loading}` after
     * `{...props}`, so the `true` below holds wherever this is spread. If that
     * `??` is ever dropped and `loading` wins outright, this silently reverts
     * to a natively disabled button and the focus drop comes back.
     *
     * `aria-busy` IS still order-dependent: `button.tsx` writes its own
     * (`loading || undefined`) before `{...props}`, so a caller value beats it.
     * That's what lets `busyButtonProps` drive it from `pending` here.
     *
     * `focusableWhenDisabled` is unconditional on purpose. The tempting
     * `focusableWhenDisabled={pending}` is worse: `useAddSkillFlow`'s `reset()`
     * clears the input when a request settles, so the blocked state outlives
     * `pending` — a conditional prop would snap the native `disabled` attribute
     * back on and drop focus at the exact moment the answer lands.
     *
     * Two accepted costs. The button is a permanent tab stop even at rest, which
     * is what `reasonProps` exists to make non-silent. And Base UI
     * `preventDefault`s every key except Tab while `aria-disabled`, so Space and
     * PageDown will not scroll from here.
     *
     * Dropping the native attribute is safe because it was never what prevented a
     * double submit: `useAddSkillFlow` latches on an `inFlight` ref read
     * synchronously before the first `await`.
     */
    submitProps: {
      disabled: blocked,
      ...busyButtonProps({ inFlight: pending }),
      // Scalar, not merged: neither submit button has another description. A
      // caller that needs one must compose the ids itself rather than spread
      // over this.
      "aria-describedby": reason ? reasonId : undefined,
    } satisfies ButtonA11y,

    /**
     * Spread onto a `<p>` next to the button, or `null` when there is nothing to
     * describe: `{reasonProps && <p {...reasonProps} />}`.
     *
     * Carries `sr-only` so the class travels with the contract rather than being
     * re-typed per surface — a caller that forgot it would ship visible duplicate
     * text. Render it OUTSIDE any live region: it describes a control, and inside
     * one it becomes a repeated announcement. Render it only where the submit
     * button actually exists, or it is a description with no referrer.
     */
    reasonProps: reason
      ? { id: reasonId, className: "sr-only", children: reason }
      : null,
  };
}
