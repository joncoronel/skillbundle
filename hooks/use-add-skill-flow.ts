"use client";

/**
 * The add-skill sequencing, owned once.
 *
 * Adding a skill is a PROTOCOL with the server, not a single call:
 *
 *   1. Try the normal add (`addSkillManually*`). It resolves against the
 *      skills.sh detail endpoint, so a skill that's listed but not yet in our
 *      catalog lands as a proper skill here and costs no quota.
 *   2. On `not_on_skills_sh`, resolve the SKILL.md in its GitHub repo
 *      (`previewGitHubSkill*`).
 *   3. That preview can come back `on_skills_sh_as_alias` — skills.sh DOES
 *      list the skill, under the slug its frontmatter name implies rather than
 *      the folder name the pasted link carried. Re-run step 1 under that slug.
 *   4. Otherwise show the resolved file and wait for an explicit confirm
 *      (`addSkillFromGitHub*`), because an automatic fallback would let a
 *      mistyped slug silently bind to the wrong SKILL.md.
 *
 * Two components drive that protocol — the public flow (`/add` and the search
 * empty-state dialog) and the admin form (`/dev/add-skill`) — against the same
 * server contract, differing only in which action variants they call and how
 * they report. Keeping two copies of the sequencing meant every protocol change
 * needed two synchronised edits with nothing enforcing the second; the slug-alias
 * fix was the second commit in a row to make exactly that pair of edits.
 *
 * So the hook owns the sequence and the state it runs on (`input`, `phase`,
 * `candidate`), and hands every terminal point to ONE `report` callback as a
 * discriminated union. Reporting is where the two genuinely differ — an
 * aria-live notice with a "View skill" link vs a toast — and a union lets that
 * difference be exhaustive-checked instead of duplicated.
 *
 * "Lets" is load-bearing: TS does NOT check a `switch` for exhaustiveness
 * inside a void-returning function, so each consumer has to close its own
 * switch with a `default` that assigns `outcome` to `never`. Without that line,
 * adding an arm here compiles clean and both surfaces silently do nothing at
 * that terminal point. See either consumer's `report`.
 *
 * Generic over the preview's `ok` shape because the public action adds `quota`
 * to it and the admin action doesn't.
 */

import { useCallback, useRef, useState } from "react";
import type { FunctionReference, FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import type { PreviewFailure } from "@/lib/add-skill-copy";

/**
 * The three action-result slots below all derive from the PUBLIC actions, even
 * though the admin surface passes admin actions in. That is safe by
 * construction rather than by luck: each pair shares ONE return validator
 * server-side — `manualAddReturns` (skills.ts) for the manual adds,
 * `gitHubAddReturns` (githubOnly.ts) for the confirms, and `previewTerminalArms`
 * for every preview failure — so neither half of a pair can gain a field
 * without the other. If one is ever un-shared, the admin form breaks with a
 * type error pointing at an action it never calls, which is the same trap
 * `PreviewOkBase` below is hand-written to avoid; keep the validators shared.
 */
type ManualAddResult = FunctionReturnType<
  typeof api.skills.addSkillManuallyPublic
>;

/**
 * A manual add that actually changed something.
 *
 * `not_on_skills_sh` is the fall-through signal, and `already_exists` gets its
 * own outcome arm before this type is ever constructed — so excluding both
 * makes `outcome.result.status === "already_exists"` inside the `added` arm
 * unrepresentable rather than merely unreachable. (It would have rendered
 * "X was added" for a row that wasn't.)
 *
 * Note `ManualAddResult` is ONE object with a union-typed `status`, not a union
 * of objects, so an outer `Exclude<...>` on it does nothing; the intersection
 * below is what narrows.
 */
export type SettledAddResult = ManualAddResult & {
  status: Exclude<
    ManualAddResult["status"],
    "not_on_skills_sh" | "already_exists"
  >;
};

/**
 * The confirm action returns EITHER a written row or a preview failure: its
 * re-check runs the same `previewGitHubCore` the preview does, so a refusal is
 * one of the same statuses rather than a separate thrown message.
 *
 * Two types because they serve opposite directions. The action *parameter* must
 * accept everything the action can return; the `github_added` outcome carries
 * only the success arm, so consumers rendering "X was added" cannot be handed a
 * refusal. Failures route through `preview_failed`, which both surfaces already
 * render.
 */
type GitHubAddResult = FunctionReturnType<
  typeof api.githubOnly.addSkillFromGitHubPublic
>;

type GitHubAddSuccess = Extract<
  GitHubAddResult,
  { status: "inserted" | "relisted" }
>;

/**
 * All the hook needs of a preview's `ok` arm — it never reads a field, only
 * checks `status` and passes the object through.
 *
 * Deliberately NOT derived from either action's return type. Deriving it from
 * the admin action would make the PUBLIC consumer's type have to structurally
 * extend an action it never calls, so an admin-only field added to that `ok`
 * arm would break the public flow with an error pointing somewhere it has no
 * business looking. They happen to agree today only because both validators
 * share one `previewOkFields` object server-side.
 */
export type PreviewOkBase = { status: "ok" };

/** Extract a preview action's `ok` arm, so consumers don't hand-roll it. */
export type PreviewOkOf<
  A extends FunctionReference<"action", "public" | "internal">,
> = Extract<FunctionReturnType<A>, { status: "ok" }>;

/** A resolved candidate plus the input that produced it, so confirm re-sends
 *  exactly what the preview saw (the action re-verifies regardless). */
export type Candidate<TOk extends PreviewOkBase> = TOk & { input: string };

/** Identifies the slug a corrected-slug retry actually used. */
type AliasRef = { source: string; skillId: string };

/**
 * Passed to `report` as a second argument rather than read off the hook's
 * return value, because a reporter defined before the hook call cannot close
 * over that return without a temporal-dead-zone crash — which is exactly the
 * bug the public flow's quota backstop hit when it tried.
 */
export type ReportHelpers<TOk extends PreviewOkBase> = {
  /** Amend the pending candidate in place, e.g. to reflect a quota rejection
   *  the server discovered only at confirm time. No-op if none is pending. */
  patchCandidate: (fn: (c: Candidate<TOk>) => Candidate<TOk>) => void;
};

/**
 * Every terminal point of the protocol. The hook reports FACTS; each consumer
 * renders its own copy from them (see `lib/add-skill-copy.ts`), so the wording
 * can differ per surface without the sequencing forking.
 */
export type AddSkillOutcome<TOk extends PreviewOkBase> =
  /** A submit passed its guards and is starting — clear any previous display. */
  | { kind: "submitting" }
  /** A skill was added, relisted, or adopted. `viaAlias` is set when step 3
   *  fired, i.e. the slug that landed is NOT the one in the pasted link. */
  | { kind: "added"; result: SettledAddResult; viaAlias?: AliasRef }
  /** A GitHub-only confirm succeeded. */
  | { kind: "github_added"; result: GitHubAddSuccess }
  /** The row is already in the catalog — possibly under a different slug than
   *  the caller typed, which is why the identifiers are carried. */
  | { kind: "already_exists"; source: string; skillId: string; name: string }
  /** The repo resolved; `candidate` is now set and awaits confirm. */
  | { kind: "candidate"; preview: TOk }
  /** The preview answered, but with nothing addable. */
  | { kind: "preview_failed"; preview: PreviewFailure }
  /** The preview CALL threw — a GitHub-side failure, which the admin surface
   *  deliberately titles differently from an add failure. */
  | { kind: "preview_threw"; error: unknown }
  /** Anything else in the sequence threw. */
  | { kind: "failed"; error: unknown };

/**
 * One async step in flight at a time; the phase names it so the button can say
 * what is actually happening. `retrying` is the step-3 re-run — a distinct
 * phase rather than a reuse of `adding` so one submit's labels only ever move
 * forward. Going back to "Checking…" reads as a stall on what is already the
 * slowest path in the flow.
 */
type AddSkillPhase =
  | "idle"
  | "adding"
  | "previewing"
  | "retrying"
  | "confirming";

const ADD_SKILL_PHASE_LABEL: Record<
  Exclude<AddSkillPhase, "idle">,
  string
> = {
  // "Checking…", not "Adding…": this first step is a skills.sh lookup that is
  // often about to 404 into the GitHub branch. Nothing is being added yet.
  adding: "Checking…",
  previewing: "Checking GitHub…",
  retrying: "Adding under its listed name…",
  confirming: "Adding…",
};

export function useAddSkillFlow<TOk extends PreviewOkBase>({
  initialInput = "",
  addManually,
  previewGitHub,
  addFromGitHub,
  report,
}: {
  initialInput?: string;
  addManually: (args: { input: string }) => Promise<ManualAddResult>;
  previewGitHub: (args: { input: string }) => Promise<PreviewFailure | TOk>;
  addFromGitHub: (args: { input: string }) => Promise<GitHubAddResult>;
  report: (
    outcome: AddSkillOutcome<TOk>,
    helpers: ReportHelpers<TOk>,
  ) => void;
}) {
  const [input, setInput] = useState(initialInput);
  const [phase, setPhase] = useState<AddSkillPhase>("idle");
  const [candidate, setCandidate] = useState<Candidate<TOk> | null>(null);

  const pending = phase !== "idle";

  /**
   * The double-submit latch, deliberately a ref and not `phase`.
   *
   * `phase` is render state, so a guard reading it reads a value captured when
   * the callback was created. That holds while callers reach `submit`
   * synchronously inside one event — but the contract below invites them to run
   * their own gates first, and one `await` in a gate is enough: the captured
   * value goes stale, the `setPhase` no longer batches with the click, and two
   * rapid submits both pass. The second would win the phase while the first's
   * `finally` cleared the latch mid-request. A ref is read and written
   * synchronously, so it can't drift. `phase` stays purely for labels.
   */
  const inFlight = useRef(false);

  const candidateInput = candidate?.input ?? null;

  const patchCandidate = useCallback(
    (fn: (c: Candidate<TOk>) => Candidate<TOk>) =>
      setCandidate((c) => (c ? fn(c) : c)),
    [],
  );

  /**
   * Every report goes through here so `helpers` can't be forgotten.
   *
   * A throwing reporter is contained here rather than allowed to escape. The
   * terminal `emit` calls sit inside the protocol's own `try`, so without this
   * a reporter that throws — and `report` is arbitrary consumer code, reaching
   * `toast` and `setState` — would be caught by that `catch` and re-reported as
   * `{ kind: "failed" }`, announcing a failure for a write that succeeded. A
   * reporter fault is not a protocol failure.
   */
  const emit = useCallback(
    (outcome: AddSkillOutcome<TOk>) => {
      try {
        report(outcome, { patchCandidate });
      } catch (err) {
        console.error("add-skill reporter threw", err);
      }
    },
    [report, patchCandidate],
  );

  /** Clear the field and any pending candidate — what a settled add leaves. */
  const reset = useCallback(() => {
    setInput("");
    setCandidate(null);
  }, []);

  /**
   * Step 1, also reused by step 3. Returns false ONLY for `not_on_skills_sh`,
   * the caller's cue to fall through to the GitHub branch; every other outcome
   * is reported here and settles the submit.
   *
   * Destructuring `status` keeps the narrowing alive into the outcome —
   * it's a union-typed property, not a discriminant.
   */
  const runManualAdd = useCallback(
    async (candidateInput: string, viaAlias?: AliasRef): Promise<boolean> => {
      const result = await addManually({ input: candidateInput });
      const { status } = result;
      if (status === "not_on_skills_sh") return false;
      if (status === "already_exists") {
        emit({
          kind: "already_exists",
          source: result.source,
          skillId: result.skillId,
          name: result.name,
        });
        return true;
      }
      reset();
      emit({ kind: "added", result: { ...result, status }, viaAlias });
      return true;
    },
    [addManually, emit, reset],
  );

  /** Steps 2–4. */
  const offerGitHubFallback = useCallback(
    async (trimmed: string) => {
      // Only the preview call is wrapped. Everything after it talks to
      // skills.sh, not GitHub, and those failures carry their own actionable
      // messages that must not be re-titled as a GitHub problem — they belong
      // to the caller's catch.
      let preview: PreviewFailure | TOk;
      try {
        preview = await previewGitHub({ input: trimmed });
      } catch (error) {
        emit({ kind: "preview_threw", error });
        return;
      }

      if (preview.status === "ok") {
        setCandidate({ ...preview, input: trimmed });
        emit({ kind: "candidate", preview });
        return;
      }
      // The preview reads the SKILL.md, so it sees the frontmatter `name` —
      // the string skills.sh derives its slug from. A GitHub link only carries
      // the FOLDER name, and repos that namespace their skills make those
      // differ, so both of the next two mean step 1 asked about the wrong slug
      // rather than that the skill is missing.
      if (preview.status === "already_exists") {
        emit({
          kind: "already_exists",
          source: preview.source,
          skillId: preview.skillId,
          name: preview.name,
        });
        return;
      }
      if (preview.status === "on_skills_sh_as_alias") {
        // Step 3: re-run the normal add under the slug that actually resolves,
        // instead of telling the user to retry the input that just failed. The
        // server only sends this status when the pasted link pointed at that
        // exact folder, so the skill being added is the one they named — but it
        // lands under a different slug, which `viaAlias` carries so the
        // consumer can say so rather than let the substitution pass unremarked.
        setPhase("retrying");
        const alias = { source: preview.source, skillId: preview.skillId };
        if (await runManualAdd(`${alias.source}/${alias.skillId}`, alias)) {
          return;
        }
      }
      emit({ kind: "preview_failed", preview });
    },
    [previewGitHub, emit, runManualAdd],
  );

  /**
   * Run the protocol for `trimmed`. Surface-specific gates (auth, input-shape
   * validation) belong in the caller and run BEFORE this — the public flow's
   * signed-out redirect has to fire even on an empty field, which an entry
   * guard in here could not express.
   */
  const submit = useCallback(
    async (trimmed: string) => {
      if (!trimmed || inFlight.current) return;
      // The candidate card for this exact input is already on screen — nothing
      // to re-fetch. Not a cache: any change to the input invalidates the
      // candidate, and confirm re-verifies server-side regardless.
      //
      // Callers must mirror this in the submit button's `disabled` via
      // `submitBlocked` below; an enabled button whose click does nothing at
      // all is worse than no button.
      if (candidateInput === trimmed) return;

      inFlight.current = true;
      setCandidate(null);
      emit({ kind: "submitting" });
      setPhase("adding");
      try {
        if (await runManualAdd(trimmed)) return;
        setPhase("previewing");
        await offerGitHubFallback(trimmed);
      } catch (error) {
        emit({ kind: "failed", error });
      } finally {
        inFlight.current = false;
        setPhase("idle");
      }
    },
    // `candidateInput`, not `candidate`: this only ever reads the input, so
    // depending on the whole object rebuilt `submit` on every `patchCandidate`.
    [candidateInput, emit, runManualAdd, offerGitHubFallback],
  );

  const confirmGitHub = useCallback(async () => {
    if (!candidate || inFlight.current) return;
    inFlight.current = true;
    setPhase("confirming");
    try {
      const result = await addFromGitHub({ input: candidate.input });
      // The server re-checks at confirm time and can refuse — a preview status,
      // not an error, so it renders through the same arm the preview's own
      // refusals use. The candidate stays on screen: the refusal explains why
      // this file can't be added, and dropping the card would take away the
      // context that explanation refers to.
      //
      // Narrowed positively. Excluding the two success statuses instead does
      // NOT narrow, because the success arm's `status` is itself a union.
      if (result.status === "inserted" || result.status === "relisted") {
        reset();
        emit({ kind: "github_added", result });
        return;
      }
      emit({ kind: "preview_failed", preview: result });
    } catch (error) {
      emit({ kind: "failed", error });
    } finally {
      inFlight.current = false;
      setPhase("idle");
    }
  }, [candidate, addFromGitHub, emit, reset]);

  /**
   * Retyping a different skill invalidates a pending candidate so its Confirm
   * can't add the previous input — the exact mis-add the confirm step exists
   * to prevent. Functional form: no stale closure over `candidate`.
   */
  const changeInput = useCallback((value: string) => {
    setInput(value);
    setCandidate((prev) =>
      prev && value.trim() !== prev.input ? null : prev,
    );
  }, []);

  // Named, not inlined into the returned object literal: a `useCallback` in
  // there is legal only while the return is unconditional, so an early return
  // added above would silently change hook order at runtime, and it reads as an
  // object property where nobody thinks to check the rule.
  const clearCandidate = useCallback(() => setCandidate(null), []);

  return {
    input,
    /**
     * The only way to write the field. `setInput` is deliberately NOT returned:
     * it would skip the candidate invalidation below, leaving a stale card
     * whose Confirm adds the previous input — the mis-add the confirm step
     * exists to prevent. A doc comment is a weaker guard than absence.
     */
    changeInput,
    phase,
    pending,
    label: phase === "idle" ? null : ADD_SKILL_PHASE_LABEL[phase],
    /**
     * True when `submit` would be a no-op for the current input: a step is in
     * flight, the field is empty, or the candidate card already answers this
     * exact input. Fold it into the submit button's `disabled` so the
     * affordance matches the guard — otherwise an enabled primary button
     * produces no toast, no label change and no state change at all, and the
     * admin card's own advice to "re-run the normal add" reads as broken.
     */
    submitBlocked:
      pending || !input.trim() || candidate?.input === input.trim(),
    candidate,
    clearCandidate,
    submit,
    confirmGitHub,
  };
}
