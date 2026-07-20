"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { parseSkillInput } from "@/lib/parse-skill-input";
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
  status: "inserted" | "relisted" | "already_exists";
  source: string;
  skillId: string;
  name: string;
};

// A resolved GitHub-only candidate awaiting the admin's confirmation. `input` is
// carried alongside so the confirm call re-sends exactly what produced this
// preview (the action re-resolves server-side rather than trusting these fields).
type GitHubCandidate = {
  input: string;
  source: string;
  skillId: string;
  path: string;
  name: string;
  description?: string;
};

export function AddSkillForm() {
  const { data: admin } = useQuery(convexQuery(api.devStats.isAdmin, {}));
  const addSkill = useAction(api.skills.addSkillManually);
  const previewGitHub = useAction(api.skills.previewGitHubSkill);
  const addFromGitHub = useAction(api.skills.addSkillFromGitHub);

  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [lastAdded, setLastAdded] = useState<AddResult | null>(null);
  const [candidate, setCandidate] = useState<GitHubCandidate | null>(null);

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
    switch (result.status) {
      case "inserted":
        toast.success({
          title: "Skill added",
          description: `${result.name} is now in the catalog. SKILL.md will fill in shortly.`,
        });
        break;
      case "relisted":
        toast.success({
          title: "Skill relisted",
          description: `${result.name} was previously delisted and is now active again.`,
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

    setPending(true);
    setCandidate(null);
    try {
      const result = await addSkill({ input: trimmed });
      // Not on skills.sh at all — a TYPED status, not an error. (It must not be
      // signaled by throwing: prod Convex redacts non-ConvexError messages to a
      // generic "Server Error", so any message-sniffing branch would be dead in
      // production.) Rather than dead-ending, look for the skill in its GitHub
      // repo and let the admin confirm what we found. Confirmation is
      // deliberate: a mistyped slug should be visible before anything is written.
      // Destructured so the narrowing survives into the else branch (status is
      // a union-typed property, not a discriminant).
      const { status } = result;
      if (status === "not_on_skills_sh") {
        await offerGitHubFallback(trimmed);
      } else {
        announce({ ...result, status });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error({
        title: "Couldn't add skill",
        description: friendlyError(message),
      });
    } finally {
      setPending(false);
    }
  }

  async function offerGitHubFallback(trimmed: string) {
    try {
      const preview = await previewGitHub({ input: trimmed });
      if (preview.status === "ok") {
        setCandidate({ input: trimmed, ...preview });
        // The confirmation card mounts silently below the form; without this,
        // a keyboard/screen-reader user hears "Adding…" end and gets no signal
        // that a confirmation step now exists further down the page.
        toast.info({
          title: "Not on skills.sh",
          description: `Found ${preview.path} on GitHub — review and confirm below.`,
        });
        return;
      }
      toast.error({
        title: "Not on skills.sh",
        description: previewError(preview.status),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error({
        title: "Couldn't check GitHub",
        description: friendlyError(message),
      });
    }
  }

  async function handleConfirmGitHub() {
    if (!candidate || pending) return;
    setPending(true);
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
      setPending(false);
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
                setInput(e.target.value);
                // Retyping a different skill while the confirmation card is up
                // would otherwise leave a stale card whose Confirm adds the OLD
                // input — the exact mis-add the confirm step exists to prevent.
                if (candidate && e.target.value.trim() !== candidate.input) {
                  setCandidate(null);
                }
              }}
              disabled={pending}
              autoFocus
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Paste a skills.sh URL or the <code>source/slug</code> form. If
                the skill isn&apos;t on skills.sh, we&apos;ll look for it in the
                GitHub repo instead.
              </p>
              <Button type="submit" disabled={!input.trim() || pending}>
                {pending ? "Adding…" : "Add to catalog"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {candidate && (
        <Card>
          <CardHeader>
            <CardTitle>Not on skills.sh — add from GitHub?</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              skills.sh has no listing for this skill, but a SKILL.md was found
              in the repo. Check that this is the right file before adding.
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
              skills.sh, at which point the daily sync takes over automatically.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <Button onClick={handleConfirmGitHub} disabled={pending}>
                {pending ? "Adding…" : "Add as GitHub-only"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setCandidate(null)}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {lastAdded && (
        <Card>
          <CardHeader>
            <CardTitle>Last added</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-medium">{lastAdded.status}</dd>
              <dt className="text-muted-foreground">Name</dt>
              <dd className="font-medium">{lastAdded.name}</dd>
              <dt className="text-muted-foreground">Source</dt>
              <dd className="font-mono text-xs">{lastAdded.source}</dd>
              <dt className="text-muted-foreground">Slug</dt>
              <dd className="font-mono text-xs">{lastAdded.skillId}</dd>
            </dl>
            <div className="mt-4">
              <Button
                nativeButton={false}
                variant="outline"
                size="sm"
                render={
                  <Link
                    href={skillDetailHref(lastAdded.source, lastAdded.skillId)}
                    target="_blank"
                  />
                }
              >
                Open on SkillBundle
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
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

// Why the GitHub fallback couldn't offer anything, in terms the admin can act on.
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
      return "skills.sh does list this skill — retry the normal add.";
    case "already_exists":
      return "This skill is already in the catalog.";
    case "no_repo":
      return "Couldn't find a public GitHub repo at that owner/repo (or GitHub rate-limited the lookup — try again in a minute).";
    case "no_skill_md":
      return "No matching SKILL.md in that repo (matched by folder name and frontmatter name) — check the slug.";
    case "tree_unavailable":
      return "Couldn't list the repo's files (too large or GitHub rate-limited); the conventional SKILL.md paths were probed with no match. Try again shortly.";
  }
}

// Convert raw error strings from the Convex action into something the admin
// can actually act on. Avoids surfacing internal stack-trace prefixes
// (e.g. "[Request ID: ...]") in toasts.
function friendlyError(raw: string): string {
  const cleaned = raw.replace(/\[Request ID:.*?\]\s*/g, "").trim();
  if (/URL must be from skills\.sh/i.test(cleaned)) {
    return "That URL isn't from skills.sh. Paste a skills.sh URL or a source/slug.";
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
