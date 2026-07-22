"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useConvexAuth } from "convex/react";
import { ConvexError } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { parseSkillInput } from "@/lib/parse-skill-input";
import { skillHref } from "@/lib/skill-urls";
import { signInUrl } from "@/components/auth/shared";
import { Button } from "@/components/ui/cubby-ui/button";
import { Input } from "@/components/ui/cubby-ui/input";
import { Label } from "@/components/ui/cubby-ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/cubby-ui/card";
import { UpgradeBanner } from "@/components/upgrade-banner";

// Derived from the server's return validator so the client can't drift from
// what the action actually sends (the review's finding on hand-declared
// shapes). `input` is carried alongside so the confirm call re-sends exactly
// what produced this preview; the action re-verifies server-side regardless.
type PreviewResult = FunctionReturnType<
  typeof api.githubOnly.previewGitHubSkillPublic
>;
type PreviewOk = Extract<PreviewResult, { status: "ok" }>;
type GitHubCandidate = PreviewOk & { input: string };

// The outcome of a completed add, for the success card.
type Added = {
  kind: "skillssh" | "github";
  source: string;
  skillId: string;
  name: string;
};

// An inline message shown under the form (already-in-catalog,
// couldn't-resolve, etc.). Rendered inside a persistent aria-live region so
// async outcomes are announced; tone drives the color.
type Notice = { tone: "info" | "error"; text: string };

// One async step in flight at a time; the phase names it so the button says
// what's actually happening.
type Phase = "idle" | "adding" | "previewing" | "confirming";

export function AddSkillFlow({
  initialInput = "",
  autoFocus,
}: {
  initialInput?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const addManually = useAction(api.skills.addSkillManuallyPublic);
  const previewGitHub = useAction(api.githubOnly.previewGitHubSkillPublic);
  const addFromGitHub = useAction(api.githubOnly.addSkillFromGitHubPublic);

  const [input, setInput] = useState(initialInput);
  const [phase, setPhase] = useState<Phase>("idle");
  const [candidate, setCandidate] = useState<GitHubCandidate | null>(null);
  const [added, setAdded] = useState<Added | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const pending = phase !== "idle";
  // The form is the permanent shell: signed-out visitors keep the input (and
  // anything they've typed/pasted) and only the submit affordance swaps to a
  // sign-in button. Swapping the whole tree after auth resolves would destroy
  // an autofocused field mid-typing.
  const signedOut = !authLoading && !isAuthenticated;

  function focusInput() {
    document.getElementById("add-skill-input")?.focus();
  }

  function succeed(a: Added) {
    setAdded(a);
    setInput("");
    setCandidate(null);
    setNotice(null);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = input.trim();
    // The auth guards mirror the button state. A signed-out Enter-press takes
    // the same path as clicking the visible "Sign in to add" button; while
    // auth is still resolving nothing fires (an action called before the
    // token lands would error even for a signed-in user).
    if (signedOut) {
      const path = window.location.pathname + window.location.search;
      router.push(signInUrl(path));
      return;
    }
    if (!trimmed || pending || authLoading || !isAuthenticated) return;
    // The candidate card for this exact input is already on screen — nothing
    // to re-fetch. (Not a cache: any change to the input invalidates the
    // candidate in onChange, and confirm re-verifies server-side regardless.)
    if (candidate?.input === trimmed) return;

    // Validate the input shape client-side before hitting the action, so a
    // typo never reaches the server (Convex forwards server throws to the dev
    // console). The action re-validates as defense-in-depth.
    try {
      parseSkillInput(trimmed);
    } catch (err) {
      setNotice({ tone: "error", text: friendlyError(errText(err)) });
      return;
    }

    setCandidate(null);
    setNotice(null);
    setAdded(null);
    setPhase("adding");
    try {
      // Branch 1: try the normal add first. It resolves against the skills.sh
      // detail endpoint, so a skill that's on skills.sh but not yet in our
      // catalog lands as a proper skill here. No quota spent.
      const result = await addManually({ input: trimmed });
      const { status } = result;
      if (status === "not_on_skills_sh") {
        // Branch 2: not on skills.sh at all. Resolve it in its GitHub repo and
        // let the user confirm before we add a GitHub-only row.
        setPhase("previewing");
        await offerGitHubFallback(trimmed);
      } else if (status === "already_exists") {
        setNotice({
          tone: "info",
          text: `${result.name} is already in the catalog.`,
        });
      } else {
        succeed({
          kind: "skillssh",
          source: result.source,
          skillId: result.skillId,
          name: result.name,
        });
      }
    } catch (err) {
      setNotice({ tone: "error", text: friendlyError(errText(err)) });
    } finally {
      setPhase("idle");
    }
  }

  async function offerGitHubFallback(trimmed: string) {
    const preview = await previewGitHub({ input: trimmed });
    if (preview.status === "ok") {
      setCandidate({ ...preview, input: trimmed });
      return;
    }
    setNotice({ tone: "error", text: previewError(preview.status) });
  }

  async function handleConfirmGitHub() {
    if (!candidate || pending) return;
    setPhase("confirming");
    try {
      const result = await addFromGitHub({ input: candidate.input });
      succeed({
        kind: "github",
        source: result.source,
        skillId: result.skillId,
        name: result.name,
      });
    } catch (err) {
      // Race backstop: the server enforces the quota atomically inside the
      // insert. When it rejects a stale confirm, flip the candidate's own
      // snapshot too so the card swaps to its upgrade state instead of
      // leaving an enabled button that keeps failing. wasDelisted flips with
      // it: relists never hit the gate, so a quota error PROVES the insert
      // was genuine and any relist marker from preview time is stale.
      if (isQuotaError(err)) {
        setCandidate((c) =>
          c
            ? {
                ...c,
                wasDelisted: false,
                quota: { ...c.quota, atLimit: true },
              }
            : c,
        );
        setNotice({ tone: "error", text: quotaErrorText(err) });
      } else {
        setNotice({ tone: "error", text: friendlyError(errText(err)) });
      }
    } finally {
      setPhase("idle");
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={handleSubmit} className="space-y-3">
        <Label htmlFor="add-skill-input">Skill link or source</Label>
        <Input
          id="add-skill-input"
          type="text"
          placeholder="github.com/owner/repo/skills/my-skill"
          value={input}
          onChange={(e) => {
            const value = e.target.value;
            setInput(value);
            // Retyping a different skill invalidates a pending candidate so its
            // Confirm can't add the previous input.
            setCandidate((prev) =>
              prev && value.trim() !== prev.input ? null : prev,
            );
            if (notice) setNotice(null);
          }}
          // readOnly, not disabled: a disabled input drops keyboard focus to
          // <body> on every Enter-submit. The button carries the disabled state.
          readOnly={pending}
          aria-invalid={notice?.tone === "error" || undefined}
          aria-describedby="add-skill-notice"
          autoFocus={autoFocus}
        />
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Paste a skills.sh URL, a GitHub link to the skill&apos;s folder, or
            the <code className="font-mono">owner/repo/slug</code> form. If it
            isn&apos;t on skills.sh yet, we&apos;ll look in the GitHub repo.
          </p>
          {signedOut ? (
            <Button
              type="button"
              className="shrink-0"
              onClick={() => {
                const path =
                  window.location.pathname + window.location.search;
                router.push(signInUrl(path));
              }}
            >
              Sign in to add
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={!input.trim() || pending || authLoading}
              className="shrink-0"
            >
              {phase === "adding"
                ? "Checking…"
                : phase === "previewing"
                  ? "Checking GitHub…"
                  : "Add skill"}
            </Button>
          )}
        </div>
      </form>

      {/* Persistent live region: async outcomes (errors, info, success) are
          announced to screen readers instead of appearing silently after the
          button re-enables. */}
      <div role="status" aria-live="polite" className="space-y-5">
        <p
          id="add-skill-notice"
          className={
            notice
              ? notice.tone === "error"
                ? "text-sm text-destructive"
                : "text-sm text-muted-foreground"
              : "sr-only"
          }
        >
          {notice?.text}
        </p>

        {added && <SuccessCard added={added} />}
      </div>

      {candidate && (
        <GitHubCandidateCard
          candidate={candidate}
          confirming={phase === "confirming"}
          disabled={pending}
          onConfirm={handleConfirmGitHub}
          onCancel={() => {
            setCandidate(null);
            // The focused Cancel button unmounts with the card; put focus
            // somewhere useful instead of letting it fall to <body>.
            focusInput();
          }}
        />
      )}
    </div>
  );
}

function GitHubCandidateCard({
  candidate,
  confirming,
  disabled,
  onConfirm,
  onCancel,
}: {
  candidate: GitHubCandidate;
  confirming: boolean;
  disabled: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { quota, wasDelisted } = candidate;
  // Relists consume no quota (the row already exists, delisted), so the
  // upgrade wall only applies to a genuine new insert.
  const blocked = quota.atLimit && !wasDelisted;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Not on skills.sh. Add it from GitHub?
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          This skill isn&apos;t listed on skills.sh, but we found a SKILL.md in
          the repo. Check it&apos;s the right file before adding.
        </p>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Name</dt>
          <dd className="font-medium">{candidate.name}</dd>
          <dt className="text-muted-foreground">Repo</dt>
          <dd className="truncate font-mono text-xs">{candidate.source}</dd>
          <dt className="text-muted-foreground">File</dt>
          <dd className="truncate font-mono text-xs">{candidate.path}</dd>
          {candidate.description && (
            <>
              <dt className="text-muted-foreground">Description</dt>
              <dd>{candidate.description}</dd>
            </>
          )}
        </dl>
        <p className="text-xs text-muted-foreground">
          It joins the catalog with a &ldquo;GitHub-only&rdquo; badge and shows
          0 installs with no security audit until it appears on skills.sh, at
          which point it&apos;s adopted as a normal skill automatically.
        </p>

        {blocked ? (
          <UpgradeBanner
            message={`You've used all ${quota.limit} of your free GitHub-only adds. Upgrade to Pro to add unlimited.`}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={onConfirm} disabled={disabled}>
              {confirming ? "Adding…" : "Add to catalog"}
            </Button>
            <Button variant="outline" onClick={onCancel} disabled={disabled}>
              Cancel
            </Button>
            {wasDelisted ? (
              <span className="text-xs text-muted-foreground">
                This skill was in the catalog before. Relisting it doesn&apos;t
                use your quota.
              </span>
            ) : (
              quota.limit !== null && (
                <span className="text-xs text-muted-foreground">
                  {quota.used} of {quota.limit} free GitHub-only adds used
                </span>
              )
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SuccessCard({ added }: { added: Added }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{added.name} was added</p>
          <p className="text-xs text-muted-foreground">
            {added.kind === "github"
              ? "Added as a GitHub-only skill."
              : "Added from skills.sh."}
          </p>
        </div>
        <Button
          nativeButton={false}
          variant="outline"
          size="sm"
          className="shrink-0"
          render={<Link href={skillHref(added.source, added.skillId)} />}
        >
          View skill
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

function errText(err: unknown): string {
  if (err instanceof ConvexError) {
    return typeof err.data === "string"
      ? err.data
      : ((err.data as { message?: string })?.message ?? "Something went wrong.");
  }
  return err instanceof Error ? err.message : String(err);
}

function isQuotaError(err: unknown): boolean {
  return (
    err instanceof ConvexError &&
    typeof err.data === "object" &&
    err.data !== null &&
    (err.data as { code?: string }).code === "quota_exceeded"
  );
}

function quotaErrorText(err: unknown): string {
  const msg =
    err instanceof ConvexError && typeof err.data === "object"
      ? (err.data as { message?: string })?.message
      : undefined;
  return (
    msg ??
    "You've used all your free GitHub-only adds. Upgrade to Pro for unlimited."
  );
}

// Why the GitHub fallback couldn't offer anything, in terms the user can act on.
function previewError(
  status:
    | "not_github"
    | "on_skills_sh"
    | "already_exists"
    | "no_repo"
    | "no_skill_md"
    | "tree_unavailable",
): string {
  switch (status) {
    case "not_github":
      return "Only GitHub repos can be added without a skills.sh listing.";
    case "on_skills_sh":
      return "skills.sh does list this skill. Try adding it again.";
    case "already_exists":
      return "This skill is already in the catalog.";
    case "no_repo":
      return "Couldn't find a public GitHub repo there (or GitHub rate-limited the lookup). Try again in a minute.";
    case "no_skill_md":
      return "No matching SKILL.md in that repo (matched by folder name and frontmatter name). Check the slug.";
    case "tree_unavailable":
      return "Couldn't list the repo's files (too large or GitHub rate-limited); the conventional SKILL.md paths were probed with no match. Try again shortly.";
  }
}

function friendlyError(raw: string): string {
  const cleaned = raw.replace(/\[Request ID:.*?\]\s*/g, "").trim();
  if (/URL must be from skills\.sh/i.test(cleaned)) {
    return "That URL isn't from skills.sh or GitHub. Paste one of those, or an owner/repo/slug.";
  }
  if (/Sign in/i.test(cleaned)) return "Sign in to add a skill.";
  if (
    /Slug is missing|Invalid skill input|Skill input is empty|looks like a domain/i.test(
      cleaned,
    )
  ) {
    return cleaned;
  }
  return cleaned || "Something went wrong.";
}
