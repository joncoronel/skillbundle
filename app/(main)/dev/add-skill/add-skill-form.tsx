"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { parseSkillInput } from "@/lib/parse-skill-input";
import {
  aliasRetryNote,
  alreadyInCatalogCopy,
  previewFailureCopy,
  previewFailureTitle,
  typedSlugOf,
} from "@/lib/add-skill-copy";
import {
  useAddSkillFlow,
  type AddSkillOutcome,
  type Candidate,
  type PreviewOkOf,
  type SettledAddResult,
} from "@/hooks/use-add-skill-flow";
import { Button } from "@/components/ui/cubby-ui/button";
import { Input } from "@/components/ui/cubby-ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/cubby-ui/card";
import { toast } from "@/components/ui/cubby-ui/toast/toast";

// Derived, not re-typed: a new server-side status shows up as a compiler-guided
// update to `announce` rather than as drift nobody notices. Broader than the
// hook's `SettledAddResult` by exactly one status — `already_exists` reaches
// `announce` through its own outcome arm rather than inside `added`. `note` is
// appended to the toast when the outcome needs explaining, currently only the
// corrected-slug retry, which lands a differently-named skill than the link.
type ManualAdd = FunctionReturnType<typeof api.skills.addSkillManually>;
type AddResult = (
  | SettledAddResult
  | (ManualAdd & { status: "already_exists" })
) & { note?: string };

// Derived from the action's return type rather than hand-declared, so a new
// preview field can't be spread into state with no type record of it. The
// admin action's `ok` arm carries no `quota` — that's the public one.
type GitHubPreviewOk = PreviewOkOf<typeof api.githubOnly.previewGitHubSkill>;
type GitHubCandidate = Candidate<GitHubPreviewOk>;

type AuditResult = FunctionReturnType<
  typeof api.githubOnlyAudit.auditGitHubOnlySlugs
>;

export function AddSkillForm() {
  const { data: admin } = useQuery(convexQuery(api.devStats.isAdmin, {}));
  const addSkill = useAction(api.skills.addSkillManually);
  const previewGitHub = useAction(api.githubOnly.previewGitHubSkill);
  const addFromGitHub = useAction(api.githubOnly.addSkillFromGitHub);

  const [lastAdded, setLastAdded] = useState<AddResult | null>(null);

  const addFailed = useCallback((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    toast.error({
      title: "Couldn't add skill",
      description: friendlyError(message),
    });
  }, []);

  /** The "Last added" card plus its toast. `note` explains a corrected-slug
   *  retry, where the skill that landed is named differently from the link. */
  const announce = useCallback((result: AddResult) => {
    setLastAdded(result);
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
          // Names the slug, which on the alias path is not the one that was
          // typed. Shared with the public flow so the two can't drift.
          description: `${alreadyInCatalogCopy(result)} No changes made.`,
        });
        break;
    }
  }, []);

  // Every terminal point of the protocol, rendered as this surface's toasts.
  // The sequencing that produces them lives in `useAddSkillFlow`; only the
  // presentation is here, which is the one thing that genuinely differs from
  // the public flow.
  const report = useCallback(
    (outcome: AddSkillOutcome<GitHubPreviewOk>) => {
      switch (outcome.kind) {
        case "submitting":
          // The "Last added" card deliberately survives a new submit — it's a
          // running log for the admin, not a per-submit result.
          return;
        case "added":
          announce({
            ...outcome.result,
            note: outcome.viaAlias
              ? aliasRetryNote(outcome.viaAlias.skillId)
              : undefined,
          });
          return;
        case "github_added":
          // The action's status ("inserted" | "relisted") is a subset of
          // AddResult's — pass it through rather than assuming, so a relist
          // reports as one.
          announce(outcome.result);
          return;
        case "already_exists":
          // NOTE: this used to clear the input too. It no longer does — the
          // hook clears only on an actual add, and the field now behaves the
          // same here as on the public flow, where keeping what you typed
          // beside "already in the catalog" is the more useful default.
          announce({
            status: "already_exists",
            source: outcome.source,
            skillId: outcome.skillId,
            name: outcome.name,
          });
          return;
        case "candidate":
          // The confirmation card mounts silently below the form; without
          // this, a keyboard/screen-reader user hears the pending label end
          // and gets no signal that a confirmation step now exists further
          // down the page.
          toast.info({
            title: "Not on skills.sh",
            description: `Found ${outcome.preview.path} on GitHub — review and confirm below.`,
          });
          return;
        case "preview_failed":
          toast.error({
            // Both derived from the status in lib/add-skill-copy.ts, so a new
            // preview status is a type error there rather than a wrong title
            // here. This used to be a hand-maintained OR-chain and had already
            // needed a third arm.
            title: previewFailureTitle(outcome.preview),
            description: previewFailureCopy(outcome.preview),
          });
          return;
        case "preview_threw": {
          // Kept distinct from `failed`: everything else in the sequence talks
          // to skills.sh, and a rate limit there carries its own actionable
          // message that must not be re-titled as a GitHub problem. Which
          // upstream is degraded is the question this page exists to answer.
          const message =
            outcome.error instanceof Error
              ? outcome.error.message
              : String(outcome.error);
          toast.error({
            title: "Couldn't check GitHub",
            description: friendlyError(message),
          });
          return;
        }
        case "failed":
          addFailed(outcome.error);
          return;
        default:
          // See the public flow's `report`: without this, a new
          // AddSkillOutcome arm compiles clean and toasts nothing.
          outcome satisfies never;
      }
    },
    [announce, addFailed],
  );

  const {
    input,
    changeInput,
    phase,
    pending,
    label,
    candidate,
    clearCandidate,
    submit,
    confirmGitHub,
  } = useAddSkillFlow<GitHubPreviewOk>({
    addManually: addSkill,
    previewGitHub,
    addFromGitHub,
    report,
  });

  if (admin === false) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        You don&apos;t have access to this page.
      </p>
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;

    // Validate the input shape client-side BEFORE calling the action. Convex
    // intentionally forwards all server-side throws to the browser console in
    // dev (visible as a red "Server Error" overlay), and there's no way to
    // suppress that — even with ConvexError. Validating client-side means
    // bad input never reaches the server, so no overlay for what's really
    // just a typo. The action still re-validates as defense-in-depth.
    try {
      parseSkillInput(trimmed);
    } catch (err) {
      addFailed(err);
      return;
    }
    await submit(trimmed);
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
              // changeInput also drops a stale confirmation card, whose
              // Confirm would otherwise add the OLD input — the exact mis-add
              // the confirm step exists to prevent.
              onChange={(e) => changeInput(e.target.value)}
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
                {label ?? "Add to catalog"}
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
          onConfirm={confirmGitHub}
          onCancel={clearCandidate}
        />
      )}

      {lastAdded && <LastAddedCard result={lastAdded} />}

      <SlugAuditCard />
    </div>
  );
}

/**
 * Finds GitHub-only rows whose stored slug disagrees with their SKILL.md's
 * frontmatter name. Two ways such a row exists: it predates the
 * frontmatter-name fix, or its SKILL.md was bound by the loose prefix arm of
 * `matchesSkillId` so the alias gate deliberately declined to fire. The path
 * that used to keep producing them — an unverifiable alias falling back to the
 * folder slug — now refuses the add instead.
 *
 * Reports only. Re-slugging moves a skill's public URL and rewrites its
 * summary, embedding and search doc, so it's a per-row human decision rather
 * than a bulk action behind a button.
 */
function SlugAuditCard() {
  const runAudit = useAction(api.githubOnlyAudit.auditGitHubOnlySlugs);
  const [data, setData] = useState<AuditResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Button-triggered, not a live query: the frontmatter `name` isn't in the
  // database (the pipeline strips it before storing the body), so each row
  // costs a GitHub fetch. That shouldn't fire on every page load.
  async function run() {
    setRunning(true);
    setError(null);
    // Drop the previous report rather than leaving it under a fresh error —
    // this answers "is that row still mis-slugged right now", so a stale
    // result presented as current is the wrong default.
    setData(null);
    try {
      setData(await runAudit({}));
    } catch (err) {
      setError(
        friendlyError(err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>GitHub-only slug audit</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          skills.sh derives a slug from the SKILL.md&apos;s frontmatter{" "}
          <code>name</code>. A row stored under a different slug can never be
          adopted, and reconcile skips it. Re-reads each row&apos;s SKILL.md
          from GitHub.
        </p>

        <Button
          variant="outline"
          onClick={run}
          disabled={running}
          aria-busy={running}
        >
          {running ? "Checking…" : data ? "Re-run audit" : "Run audit"}
        </Button>

        {/* The button's label is the only progress signal and it sits on a
            disabled control, so it is never announced — and a run is up to
            ~20 serial round trips. Results and errors land in here too, so
            completion isn't silent. */}
        <div role="status" aria-live="polite" className="space-y-4">
          {running && (
            <p className="sr-only">Checking GitHub-only slugs…</p>
          )}

          {error && (
            <p className="text-destructive">
              Couldn&apos;t run the audit: {error}
            </p>
          )}

          {data && (
            <>
              <p className="text-muted-foreground">
                Judged {data.judged} of {data.total} GitHub-only{" "}
                {data.total === 1 ? "row" : "rows"}
                {data.truncated && " (more exist than this run read)"}.
              </p>

              {data.mismatches.length === 0 ? (
                // Qualified when some rows couldn't be read: an unqualified
                // "none" over a pile of unjudged rows is the false negative
                // this whole card exists to avoid.
                <p className="font-medium">
                  {data.unknown.length > 0
                    ? `No mis-slugged rows among the ${data.judged} judged.`
                    : "No mis-slugged rows."}
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="font-medium text-destructive">
                    {data.mismatches.length} mis-slugged{" "}
                    {data.mismatches.length === 1 ? "row" : "rows"}:
                  </p>
                  <ul className="space-y-2">
                    {data.mismatches.map((m) => (
                      <li
                        key={`${m.source}/${m.skillId}`}
                        className="rounded-md border p-3"
                      >
                        <p className="font-medium">{m.name}</p>
                        <p className="font-mono text-xs break-all">
                          <Link
                            href={skillDetailHref(m.source, m.skillId)}
                            target="_blank"
                            className="underline underline-offset-2 hover:no-underline"
                          >
                            {m.source}/{m.skillId}
                          </Link>
                          {m.isDelisted && " (delisted)"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Its SKILL.md is named{" "}
                          <code className="font-mono">
                            {m.expectedSkillId}
                          </code>
                          , so skills.sh would list it as{" "}
                          <code className="font-mono">
                            {m.source}/{m.expectedSkillId}
                          </code>
                          .
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {data.unknown.length > 0 && (
                <div className="space-y-1">
                  <p className="text-muted-foreground">
                    {data.unknown.length}{" "}
                    {data.unknown.length === 1 ? "row" : "rows"} couldn&apos;t
                    be judged — not the same as being wrong:
                  </p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {data.unknown.map((u) => (
                      <li key={`${u.source}/${u.skillId}`}>
                        <Link
                          href={skillDetailHref(u.source, u.skillId)}
                          target="_blank"
                          className="font-mono break-all underline underline-offset-2 hover:no-underline"
                        >
                          {u.source}/{u.skillId}
                        </Link>{" "}
                        — {u.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
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
  // The slug is the one field the server can change out from under the pasted
  // link, and this page is where slug mismatches get diagnosed — so it is the
  // last place the swap should go unexplained.
  const typedSlug = typedSlugOf(candidate.input);
  const slugChanged = typedSlug !== null && typedSlug !== candidate.skillId;
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
        {slugChanged && (
          <p className="mt-4 text-xs text-muted-foreground">
            The slug comes from the name inside the SKILL.md, not the{" "}
            <code className="font-mono">{typedSlug}</code> folder in the link —
            that&apos;s the name skills.sh would give it too.
          </p>
        )}
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
