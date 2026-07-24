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
 * aria-live notice with a "View skill" link vs a toast — and a union keeps that
 * difference exhaustive-checked instead of duplicated.
 *
 * Generic over the preview's `ok` shape because the public action adds `quota`
 * to it and the admin action doesn't.
 */

import { useCallback, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import type { PreviewFailure } from "@/lib/add-skill-copy";

type ManualAddResult = FunctionReturnType<
  typeof api.skills.addSkillManuallyPublic
>;

/** A settled manual add — every status except the fall-through signal. */
export type SettledAddResult = Exclude<
  ManualAddResult,
  { status: "not_on_skills_sh" }
> & { status: Exclude<ManualAddResult["status"], "not_on_skills_sh"> };

type GitHubAddResult = FunctionReturnType<
  typeof api.githubOnly.addSkillFromGitHubPublic
>;

/**
 * The fields both preview actions' `ok` arms share. The admin action returns
 * exactly this; the public one returns it plus `quota`.
 */
export type PreviewOkBase = Extract<
  FunctionReturnType<typeof api.githubOnly.previewGitHubSkill>,
  { status: "ok" }
>;

/** A resolved candidate plus the input that produced it, so confirm re-sends
 *  exactly what the preview saw (the action re-verifies regardless). */
export type Candidate<TOk extends PreviewOkBase> = TOk & { input: string };

/** Identifies the slug a corrected-slug retry actually used. */
export type AliasRef = { source: string; skillId: string };

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
  | { kind: "github_added"; result: GitHubAddResult }
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
export type AddSkillPhase =
  | "idle"
  | "adding"
  | "previewing"
  | "retrying"
  | "confirming";

export const ADD_SKILL_PHASE_LABEL: Record<
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

  const patchCandidate = useCallback(
    (fn: (c: Candidate<TOk>) => Candidate<TOk>) =>
      setCandidate((c) => (c ? fn(c) : c)),
    [],
  );

  /** Every report goes through here so `helpers` can't be forgotten. */
  const emit = useCallback(
    (outcome: AddSkillOutcome<TOk>) => report(outcome, { patchCandidate }),
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
      if (!trimmed || pending) return;
      // The candidate card for this exact input is already on screen — nothing
      // to re-fetch. Not a cache: any change to the input invalidates the
      // candidate, and confirm re-verifies server-side regardless.
      if (candidate?.input === trimmed) return;

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
        setPhase("idle");
      }
    },
    [pending, candidate, emit, runManualAdd, offerGitHubFallback],
  );

  const confirmGitHub = useCallback(async () => {
    if (!candidate || pending) return;
    setPhase("confirming");
    try {
      const result = await addFromGitHub({ input: candidate.input });
      reset();
      emit({ kind: "github_added", result });
    } catch (error) {
      emit({ kind: "failed", error });
    } finally {
      setPhase("idle");
    }
  }, [candidate, pending, addFromGitHub, emit, reset]);

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

  return {
    input,
    setInput,
    /** Use instead of `setInput` on user typing — also invalidates the card. */
    changeInput,
    phase,
    pending,
    label: phase === "idle" ? null : ADD_SKILL_PHASE_LABEL[phase],
    candidate,
    clearCandidate: useCallback(() => setCandidate(null), []),
    reset,
    submit,
    confirmGitHub,
  };
}
