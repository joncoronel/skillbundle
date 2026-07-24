"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { parseSkillInput } from "@/lib/parse-skill-input";
import { previewFailureCopy } from "@/lib/add-skill-copy";
import { Button } from "@/components/ui/cubby-ui/button";
import { Input } from "@/components/ui/cubby-ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/cubby-ui/card";
import { toast } from "@/components/ui/cubby-ui/toast/toast";

type AddResult = {
  status: "inserted" | "relisted" | "already_exists" | "adopted";
  source: string;
  skillId: string;
  name: string;
  // Appended to the toast when the outcome needs explaining — currently only
  // the corrected-slug retry, which lands a differently-named skill than the
  // link that was pasted.
  note?: string;
};

// A resolved GitHub-only candidate awaiting the admin's confirmation. Derived
// from the action's return type rather than hand-declared, so a new preview
// field can't be spread into state with no type record of it. `input` is
// carried alongside so the confirm call re-sends exactly what produced this
// preview (the action re-resolves server-side rather than trusting these fields).
type GitHubCandidate = Extract<
  FunctionReturnType<typeof api.githubOnly.previewGitHubSkill>,
  { status: "ok" }
> & { input: string };

// One async flow is in flight at a time; the phase names it honestly so the
// button can say what is actually happening ("Checking GitHub…" during the
// preview, not a misleading "Adding…"). Every await site sets its own phase.
// `retrying` is the corrected-slug re-run — its own phase so one submit's
// labels only ever move forward.
type Phase = "idle" | "adding" | "previewing" | "retrying" | "confirming";

const PHASE_LABEL: Record<Exclude<Phase, "idle">, string> = {
  // "Checking…", not "Adding…": this first step is a skills.sh lookup that is
  // often about to 404 into the GitHub branch. Nothing is being added yet.
  adding: "Checking…",
  previewing: "Checking GitHub…",
  retrying: "Adding under its listed name…",
  confirming: "Adding…",
};

export function AddSkillForm() {
  const { data: admin } = useQuery(convexQuery(api.devStats.isAdmin, {}));
  const addSkill = useAction(api.skills.addSkillManually);
  const previewGitHub = useAction(api.githubOnly.previewGitHubSkill);
  const addFromGitHub = useAction(api.githubOnly.addSkillFromGitHub);

  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [lastAdded, setLastAdded] = useState<AddResult | null>(null);
  const [candidate, setCandidate] = useState<GitHubCandidate | null>(null);

  const pending = phase !== "idle";

  if (admin === false) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        You don&apos;t have access to this page.
      </p>
    );
  }

  function announce(result: AddResult) {
    setLastAdded(result);
    setInput("");
    setCandidate(null);
    const withNote = (text: string) =>
      result.note ? `${text} ${result.note}` : text;
    switch (result.status) {
      case "inserted":
        toast.success({
          title: "Skill added",
          description: withNote(
            `${result.name} is now in the catalog. SKILL.md will fill in shortly.`,
          ),
        });
        break;
      case "relisted":
        toast.success({
          title: "Skill relisted",
          description: withNote(
            `${result.name} was previously delisted and is now active again.`,
          ),
        });
        break;
      case "adopted":
        toast.success({
          title: "Skill adopted",
          description: withNote(
            `${result.name} is now listed on skills.sh — upgraded from GitHub-only to a normal catalog entry with its real install count.`,
          ),
        });
        break;
      case "already_exists":
        toast.info({
          title: "Already in catalog",
          description: `${result.name} is already listed. No changes made.`,
        });
        break;
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || pending) return;

    // Validate the input shape client-side BEFORE calling the action. Convex
    // intentionally forwards all server-side throws to the browser console in
    // dev (visible as a red "Server Error" overlay), and there's no way to
    // suppress that — even with ConvexError. Validating client-side means
    // bad input never reaches the server, so no overlay for what's really
    // just a typo. The action still re-validates as defense-in-depth.
    try {
      parseSkillInput(trimmed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error({
        title: "Couldn't add skill",
        description: friendlyError(message),
      });
      return;
    }

    setPhase("adding");
    setCandidate(null);
    try {
      if (await runManualAdd(trimmed)) return;
      // Not on skills.sh at all — a TYPED status, not an error. (It must not be
      // signaled by throwing: prod Convex redacts non-ConvexError messages to a
      // generic "Server Error", so any message-sniffing branch would be dead in
      // production.) Rather than dead-ending, look for the skill in its GitHub
      // repo and let the admin confirm what we found. Confirmation is
      // deliberate: a mistyped slug should be visible before anything is written.
      setPhase("previewing");
      await offerGitHubFallback(trimmed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error({
        title: "Couldn't add skill",
        description: friendlyError(message),
      });
    } finally {
      setPhase("idle");
    }
  }

  // The normal skills.sh add, extracted so the GitHub preview can re-run it
  // under a corrected slug. Returns false only for `not_on_skills_sh`; every
  // other outcome is announced here. Destructuring `status` keeps the
  // narrowing alive into announce() — it's a union-typed property, not a
  // discriminant.
  async function runManualAdd(
    candidateInput: string,
    note?: string,
  ): Promise<boolean> {
    const result = await addSkill({ input: candidateInput });
    const { status } = result;
    if (status === "not_on_skills_sh") return false;
    announce({ ...result, status, note });
    return true;
  }

  async function offerGitHubFallback(trimmed: string) {
    // Only the preview call is wrapped: everything after it talks to
    // skills.sh, not GitHub, and a rate limit there carries its own actionable
    // message ("skills.sh is rate-limiting requests…") that must not be
    // re-titled as a GitHub problem. Those throws belong to handleSubmit's
    // catch, which is the one written for add failures.
    let preview;
    try {
      preview = await previewGitHub({ input: trimmed });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error({
        title: "Couldn't check GitHub",
        description: friendlyError(message),
      });
      return;
    }

    if (preview.status === "ok") {
      setCandidate({ input: trimmed, ...preview });
      // The confirmation card mounts silently below the form; without this,
      // a keyboard/screen-reader user hears the pending label end and gets
      // no signal that a confirmation step now exists further down the page.
      toast.info({
        title: "Not on skills.sh",
        description: `Found ${preview.path} on GitHub — review and confirm below.`,
      });
      return;
    }
    // The preview reads the SKILL.md, so it sees the frontmatter `name` —
    // the string skills.sh derives its slug from. A GitHub link only carries
    // the FOLDER name, and repos that namespace their skills make those
    // differ, so both of these mean the add above asked about the wrong slug
    // rather than that the skill is missing.
    if (preview.status === "already_exists") {
      announce({
        status: "already_exists",
        source: preview.source,
        skillId: preview.skillId,
        name: preview.name,
      });
      return;
    }
    if (preview.status === "on_skills_sh_as_alias") {
      setPhase("retrying");
      const settled = await runManualAdd(
        `${preview.source}/${preview.skillId}`,
        `Added as "${preview.skillId}" — the name in its SKILL.md frontmatter, not the folder name in the link.`,
      );
      if (settled) return;
    }
    toast.error({
      // Derived, not hardcoded: an "on_skills_sh…" status under a
      // "Not on skills.sh" title makes one toast contradict itself.
      title:
        preview.status === "on_skills_sh" ||
        preview.status === "on_skills_sh_as_alias"
          ? "Couldn't add skill"
          : "Not on skills.sh",
      description: previewFailureCopy(preview),
    });
  }

  async function handleConfirmGitHub() {
    if (!candidate || pending) return;
    setPhase("confirming");
    try {
      // The action's status ("inserted" | "relisted") is a subset of AddResult's
      // — pass it through rather than assuming, so a relist reports as one.
      announce(await addFromGitHub({ input: candidate.input }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error({
        title: "Couldn't add skill",
        description: friendlyError(message),
      });
    } finally {
      setPhase("idle");
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Skill URL or source/slug</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="text"
              placeholder="vercel-labs/agent-skills/next-js-development"
              value={input}
              onChange={(e) => {
                const value = e.target.value;
                setInput(value);
                // Retyping a different skill while the confirmation card is up
                // would otherwise leave a stale card whose Confirm adds the OLD
                // input — the exact mis-add the confirm step exists to prevent.
                // Functional form: no stale closure over `candidate`.
                setCandidate((prev) =>
                  prev && value.trim() !== prev.input ? null : prev,
                );
              }}
              disabled={pending}
              autoFocus
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Paste a skills.sh URL, a GitHub link to the skill&apos;s
                folder, or the <code>source/slug</code> form. If the skill
                isn&apos;t on skills.sh, we&apos;ll look for it in the GitHub
                repo instead.
              </p>
              <Button type="submit" disabled={!input.trim() || pending}>
                {phase === "idle" ? "Add to catalog" : PHASE_LABEL[phase]}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {candidate && (
        <GitHubCandidateCard
          candidate={candidate}
          confirming={phase === "confirming"}
          disabled={pending}
          onConfirm={handleConfirmGitHub}
          onCancel={() => setCandidate(null)}
        />
      )}

      {lastAdded && <LastAddedCard result={lastAdded} />}
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
  return (
    <Card>
      <CardHeader>
        <CardTitle>Not on skills.sh — add from GitHub?</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          skills.sh has no listing for this skill, but a SKILL.md was found in
          the repo. Check that this is the right file before adding.
        </p>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Name</dt>
          <dd className="font-medium">{candidate.name}</dd>
          <dt className="text-muted-foreground">Repo</dt>
          <dd className="font-mono text-xs">{candidate.source}</dd>
          <dt className="text-muted-foreground">Slug</dt>
          <dd className="font-mono text-xs">{candidate.skillId}</dd>
          <dt className="text-muted-foreground">File</dt>
          <dd className="font-mono text-xs">{candidate.path}</dd>
          {candidate.description && (
            <>
              <dt className="text-muted-foreground">Description</dt>
              <dd>{candidate.description}</dd>
            </>
          )}
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">
          It will show 0 installs and no security audit until it appears on
          skills.sh — at which point the daily sync adopts it automatically, or
          re-running the normal add adopts it on the spot.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={onConfirm} disabled={disabled}>
            {confirming ? "Adding…" : "Add as GitHub-only"}
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={disabled}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function LastAddedCard({ result }: { result: AddResult }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Last added</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Status</dt>
          <dd className="font-medium">{result.status}</dd>
          <dt className="text-muted-foreground">Name</dt>
          <dd className="font-medium">{result.name}</dd>
          <dt className="text-muted-foreground">Source</dt>
          <dd className="font-mono text-xs">{result.source}</dd>
          <dt className="text-muted-foreground">Slug</dt>
          <dd className="font-mono text-xs">{result.skillId}</dd>
        </dl>
        <div className="mt-4">
          <Button
            nativeButton={false}
            variant="outline"
            size="sm"
            render={
              <Link
                href={skillDetailHref(result.source, result.skillId)}
                target="_blank"
              />
            }
          >
            Open on SkillBundle
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// GitHub sources route as /[org]/[repo]/[skillId]; well-known sources route
// as /site/[source]/[skillId]. Mirrors isGitHubSource on the backend.
function skillDetailHref(source: string, skillId: string): string {
  const parts = source.split("/");
  const isGitHub = parts.length === 2 && !parts[0].includes(".");
  return isGitHub
    ? `/${source}/${skillId}`
    : `/site/${source}/${skillId}`;
}

// Convert raw error strings from the Convex action into something the admin
// can actually act on. Avoids surfacing internal stack-trace prefixes
// (e.g. "[Request ID: ...]") in toasts.
function friendlyError(raw: string): string {
  const cleaned = raw.replace(/\[Request ID:.*?\]\s*/g, "").trim();
  if (/URL must be from skills\.sh/i.test(cleaned)) {
    return "That URL isn't from skills.sh or GitHub. Paste one of those, or a source/slug.";
  }
  if (/looks like a domain/i.test(cleaned)) {
    return cleaned;
  }
  if (/not authorized/i.test(cleaned) || /not authenticated/i.test(cleaned)) {
    return "You don't have permission to add skills.";
  }
  if (/Slug is missing|Invalid skill input|Skill input is empty/i.test(cleaned)) {
    return cleaned;
  }
  return cleaned || "Unknown error.";
}
