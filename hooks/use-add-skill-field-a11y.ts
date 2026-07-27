"use client";

/**
 * The accessibility contract shared by the two add-skill surfaces.
 *
 * `/add` (components/add-skill/add-skill-flow.tsx) and the admin form
 * (app/(main)/dev/add-skill/add-skill-form.tsx) share their state machine
 * (`useAddSkillFlow`) and their copy helpers, but each writes its own markup —
 * different labels, different layout, different blocked reasons, and a
 * signed-out branch only one of them has. That divergence is fine and is why
 * there is no shared `<AddSkillField>` component: absorbing it would take about
 * eight props, and a component that is mostly props is worse than the
 * duplication it replaces.
 *
 * What is NOT fine is that five a11y decisions were also duplicated, and those
 * must move together. All five have been corrected twice in a week, and the
 * forks are what made it twice:
 *
 *   1. The input is `readOnly` while a request is in flight, never `disabled` —
 *      a disabled element cannot hold focus, so the browser drops it to `<body>`
 *      for the length of the request, and one submit can be three round trips.
 *      The admin form kept `disabled` long after the public one switched, which
 *      silently defeated every `focusInput()` call in that file.
 *   2. The submit button is `focusableWhenDisabled`, for the same reason.
 *   3. UNCONDITIONALLY so — see `submitProps` for why a conditional prop is
 *      worse than none.
 *   4. `aria-busy` keys off the in-flight boolean, never the blocked one: a
 *      button blocked because the field is empty is not busy.
 *   5. A disabled button that is still a tab stop must say why it is disabled,
 *      which is what `reasonId` and the caller's `reasonText` are for.
 *
 * So this hook owns the CONTRACT and returns props; each surface keeps its own
 * markup and spreads them. Nothing here renders anything.
 */

/**
 * Why the submit button is unavailable, or `null` when it is usable — or when
 * it is merely busy, since the button's own label already says so.
 *
 * The caller supplies the wording because the two surfaces accept different
 * input formats and say so differently. It supplies the reason ORDER too, by
 * listing the checks; this hook does not know which of a surface's blocking
 * conditions is the most useful to name.
 */
export type BlockedReason = string | null;

export function useAddSkillFieldA11y({
  pending,
  blocked,
  reasonText,
  idPrefix,
}: {
  /** A request is in flight. Drives `readOnly` and `aria-busy`. */
  pending: boolean;
  /**
   * The button's full disabled expression — every reason, not just `pending`.
   * The admin surface passes `submitBlocked`; the public one passes
   * `submitBlocked || authLoading`.
   */
  blocked: boolean;
  /**
   * What to tell someone who tabs onto the disabled button. `null` when there is
   * nothing useful to add — including while `pending`, where the button's label
   * is already the progress signal.
   */
  reasonText: BlockedReason;
  /** Namespaces the description element's id, since both surfaces can coexist. */
  idPrefix: string;
}) {
  // Only describe a genuinely blocked control. A description on an enabled
  // button reads as a warning about a control that works fine.
  const reason = blocked && !pending ? reasonText : null;
  const reasonId = `${idPrefix}-submit-reason`;

  return {
    /**
     * Spread onto the text input.
     *
     * `readOnly`, not `disabled`: see the module header. The caller still owns
     * `value`, `onChange`, `placeholder`, `autoFocus` and any `aria-describedby`
     * pointing at its own notice region.
     */
    inputProps: { readOnly: pending } as const,

    /**
     * Spread onto the submit button, AFTER the caller's own `disabled`.
     *
     * `focusableWhenDisabled` is unconditional on purpose. The tempting
     * `focusableWhenDisabled={pending}` is worse: `useAddSkillFlow`'s `reset()`
     * clears the input when a request settles, so the blocked state outlives
     * `pending` — a conditional prop would snap the native `disabled` attribute
     * back on and drop focus at the exact moment the answer lands.
     *
     * Two accepted costs. The button is a permanent tab stop even at rest, which
     * is what `aria-describedby` exists to make non-silent. And Base UI
     * `preventDefault`s every key except Tab while `aria-disabled`, so Space and
     * PageDown will not scroll from here.
     *
     * Dropping the native attribute is safe because it was never what prevented
     * a double submit: `useAddSkillFlow` latches on an `inFlight` ref read
     * synchronously before the first `await`.
     */
    submitProps: {
      focusableWhenDisabled: true,
      "aria-busy": pending,
      "aria-describedby": reason ? reasonId : undefined,
    } as const,

    /**
     * The id and text for the description element, or `null` when there is
     * nothing to describe. The caller renders it — as `sr-only`, next to the
     * button and OUTSIDE any live region, since it describes a control rather
     * than announcing an event.
     */
    reason: reason ? { id: reasonId, text: reason } : null,
  };
}
