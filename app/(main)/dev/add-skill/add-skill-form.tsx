"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { parseSkillInput } from "@/lib/parse-skill-input";
import {
  addSkillErrorText,
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
import { SlugSwapNote } from "@/components/add-skill/slug-swap-note";

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

/** ONE page of the slug audit. The card walks several and merges them. */
type AuditPage = FunctionReturnType<
  typeof api.githubOnlyAudit.auditGitHubOnlySlugs
>;

/**
 * Every page audited so far, as one value shaped like a single page.
 *
 * Counts sum, lists concatenate, and `cursor` is the LAST page's, because that
 * is what continues the walk. Structurally identical to one page, so the
 * server's per-page field docs ("rows THIS page read") have to be read as "so
 * far" here — which is exactly why the accumulation is one named function
 * instead of five lines inside a state updater.
 *
 * Annotated as returning a page so a new field on the server's result is a type
 * error here rather than a field silently missing from the merged report.
 */
function mergeAuditPages(pages: AuditPage[]): AuditPage | null {
  if (pages.length === 0) return null;
  return pages.reduce((acc, page) => ({
    judged: acc.judged + page.judged,
    read: acc.read + page.read,
    cursor: page.cursor,
    mismatches: [...acc.mismatches, ...page.mismatches],
    unknown: [...acc.unknown, ...page.unknown],
  }));
}

export function AddSkillForm() {
  const { data: admin } = useQuery(convexQuery(api.devStats.isAdmin, {}));
  const addSkill = useAction(api.skills.addSkillManually);
  const previewGitHub = useAction(api.githubOnly.previewGitHubSkill);
  const addFromGitHub = useAction(api.githubOnly.addSkillFromGitHub);

  const [lastAdded, setLastAdded] = useState<AddResult | null>(null);

  // The candidate card unmounts on two paths (Cancel, and an `already_exists`
  // that drops it), each time taking the button the admin just pressed with it.
  // A ref rather than the public flow's `getElementById`, since this input has
  // no id to look up and inventing one to find it from three lines away would
  // be the worse of the two.
  const inputRef = useRef<HTMLInputElement>(null);
  const focusInput = useCallback(() => inputRef.current?.focus(), []);

  const addFailed = useCallback((err: unknown) => {
    toast.error({
      title: "Couldn't add skill",
      description: addSkillErrorText(err),
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
      default:
        // The comment on AddResult claims a new server-side status becomes a
        // compiler-guided update here. This line is what makes that true — a
        // void-returning switch gets no exhaustiveness check on its own, so
        // without it a sixth status would set `lastAdded` and fire no toast.
        result satisfies never;
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
          // Unconditional, unlike `already_exists` below, which has to ask
          // whether a card was mounted. This outcome can ONLY come from
          // `confirmGitHub`, which returns early without a candidate — so the
          // confirm card was always on screen and the button just pressed always
          // unmounted with it. Measured in the browser (Jul 2026): without this,
          // `document.activeElement` is `<body>` right after a successful add,
          // and a keyboard user tabs back from the top of the page.
          focusInput();
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
          // Only when this outcome dropped the confirm card, whose button the
          // admin had just pressed. Not on the plain submit path, where the
          // button they used is still mounted and moving focus would be theft.
          if (outcome.candidateDismissed) focusInput();
          return;
        case "candidate":
          // The confirmation card mounts silently below the form; without
          // this, a keyboard/screen-reader user hears the pending label end
          // and gets no signal that a confirmation step now exists further
          // down the page.
          toast.info({
            title: "Not on skills.sh",
            description: `Found ${outcome.preview.path} on GitHub. Review and confirm below.`,
          });
          return;
        case "preview_failed":
          toast.error({
            // Both derived from the status in lib/add-skill-copy.ts, so a new
            // preview status is a type error there rather than a wrong title
            // here. This used to be a hand-maintained OR-chain and had already
            // needed a third arm.
            //
            // `step` is what keeps a confirm-time refusal titled as an add
            // failure. This page's job is naming which upstream is degraded, so
            // a rate-limited GitHub at confirm time reading "Not on skills.sh"
            // points at the wrong one.
            title: previewFailureTitle(outcome.preview, outcome.step),
            description: previewFailureCopy(outcome.preview),
          });
          return;
        case "preview_threw": {
          // Kept distinct from `failed`: everything else in the sequence talks
          // to skills.sh, and a rate limit there carries its own actionable
          // message that must not be re-titled as a GitHub problem. Which
          // upstream is degraded is the question this page exists to answer.
          toast.error({
            title: "Couldn't check GitHub",
            description: addSkillErrorText(outcome.error),
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
    [announce, addFailed, focusInput],
  );

  const {
    input,
    changeInput,
    confirming,
    pending,
    label,
    submitBlocked,
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
              ref={inputRef}
              type="text"
              placeholder="vercel-labs/agent-skills/next-js-development"
              value={input}
              // changeInput also drops a stale confirmation card, whose
              // Confirm would otherwise add the OLD input — the exact mis-add
              // the confirm step exists to prevent.
              onChange={(e) => changeInput(e.target.value)}
              // readOnly, not disabled — the same choice the public flow made and
              // documented, which this surface had not adopted. A disabled
              // element cannot hold or receive focus, so `disabled` here did two
              // things: dropped focus to <body> on every Enter-submit for the
              // length of the request, and silently defeated the `focusInput()`
              // calls in `report`, since `pending` is still true when they run.
              // The confirm-card fix does not work without this. The submit
              // button carries the disabled state.
              readOnly={pending}
              autoFocus
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Paste a skills.sh URL, a GitHub link to the skill&apos;s
                folder, or the <code>source/slug</code> form. If the skill
                isn&apos;t on skills.sh, we&apos;ll look for it in the GitHub
                repo instead.
              </p>
              {/*
                `focusableWhenDisabled`, for the same reason the input above is
                `readOnly` rather than `disabled`: a natively disabled element
                cannot hold focus, so submitting by Enter dropped focus to
                `<body>` for the length of the request — and one submit can be
                three sequential round trips, so that window is seconds. A
                keyboard user then tabbed back from the top of the page.

                Safe to drop the native `disabled` attribute because it was never
                what prevented a second submit: `useAddSkillFlow` latches on an
                `inFlight` ref, read synchronously before the first `await`, so a
                double Enter-press is refused whether or not the button is
                clickable. Base UI keeps the button non-activatable and marks it
                `aria-disabled`, so this changes focus behaviour only.
              */}
              <Button type="submit" disabled={submitBlocked} focusableWhenDisabled>
                {label ?? "Add to catalog"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {candidate && (
        <GitHubCandidateCard
          candidate={candidate}
          confirming={confirming}
          disabled={pending}
          onConfirm={confirmGitHub}
          onCancel={() => {
            clearCandidate();
            // The focused Cancel button unmounts with the card. This surface had
            // no recovery at all, while the public flow has had one since the
            // card was written; same defect, so same handling.
            focusInput();
          }}
        />
      )}

      {lastAdded && <LastAddedCard result={lastAdded} />}

      <SlugAuditCard />
    </div>
  );
}

/**
 * Finds GitHub-only rows whose stored slug disagrees with their SKILL.md's
 * frontmatter name. Both paths that could write one are now closed: an
 * unverifiable alias refuses the add rather than falling back to the folder
 * slug, and the resolver matches frontmatter names exactly, so a partial name
 * resolves to nothing instead of to a misnamed row. So this looks for history
 * and guards against a regression; production audited clean at zero.
 *
 * Reports only, deliberately. `convex/githubOnlyAudit.ts`'s header is the record
 * of why there is a find button and no fix button.
 */
function SlugAuditCard() {
  const runAudit = useAction(api.githubOnlyAudit.auditGitHubOnlySlugs);
  // Pages rather than a pre-merged report: "is this a fresh run?" is then
  // expressed once (replace the array vs append to it) instead of being
  // re-derived from the cursor at each merged field, and the merge itself is a
  // pure function rather than five hand-written lines in a state updater.
  const [pages, setPages] = useState<AuditPage[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tracked separately from the pages, which a fresh run clears up front:
  // deriving the label from "do we have results" makes a failed re-run say
  // "Run audit" as though nothing had executed, right beside the error from the
  // run that did.
  const [hasRun, setHasRun] = useState(false);

  /**
   * Guards a second activation of the same cursor.
   *
   * `running` is render state, so a handler reading it reads the value captured
   * when it was created — the same staleness `useAddSkillFlow`'s `inFlight` ref
   * exists for. Two activations of one cursor would append the identical page
   * twice: `read` and `judged` would double-count and every row in it would be
   * listed twice, both lists being keyed on `source/skillId`.
   */
  const inFlight = useRef(false);

  const report = mergeAuditPages(pages);

  /**
   * Button-triggered, not a live query: the frontmatter `name` isn't in the
   * database (the pipeline strips it before storing the body), so each row costs
   * a GitHub fetch. That shouldn't fire on every page load.
   *
   * One call audits one page. Passing the previous result's `cursor` continues
   * and ACCUMULATES into the same report, so the counts and both lists describe
   * everything audited so far rather than just the last page — a per-page report
   * would make "no mis-slugged rows" true of a slice and read as true of the
   * catalog.
   */
  async function run(cursor: string | null) {
    if (inFlight.current) return;
    inFlight.current = true;
    setRunning(true);
    setHasRun(true);
    setError(null);
    // A fresh run drops the previous report rather than leaving it under a new
    // error: this answers "is that row still mis-slugged right now", so a stale
    // result presented as current is the wrong default. Continuing keeps it.
    if (cursor === null) setPages([]);
    try {
      const next = await runAudit({ cursor });
      setPages((prev) => (cursor === null ? [next] : [...prev, next]));
    } catch (err) {
      setError(addSkillErrorText(err));
    } finally {
      inFlight.current = false;
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

        <div className="flex flex-wrap items-center gap-3">
          {/* Same focus strategy as its sibling below, deliberately: a plain
              disabled button also drops focus to <body>, and a page fetch is
              ~200 GitHub round trips to stand there for. Two controls in one row
              with two strategies was the half-answer the review flagged. */}
          <Button
            variant="outline"
            onClick={() => run(null)}
            disabled={running}
            focusableWhenDisabled
            aria-busy={running}
          >
            {running ? "Checking…" : hasRun ? "Re-run audit" : "Run audit"}
          </Button>
          {/* Lets the admin cover the whole population without the server
              persisting where it got to. Stays MOUNTED for the length of the
              walk rather than being conditional on there being a next page: a
              control that unmounts on its own click drops keyboard focus to
              <body>, and paging is a deliberate multi-click workflow — up to
              ~20 clicks, so that would be ~20 trips back from the top of the
              page. `focusableWhenDisabled` is what holds focus through the
              disabled states; the component sets it only for `loading`, and a
              passed prop wins over that. The exhausted label is also the only
              in-place signal that the walk is done. */}
          {report && (
            <Button
              variant="ghost"
              onClick={() => {
                if (report.cursor) run(report.cursor);
              }}
              disabled={running || !report.cursor}
              focusableWhenDisabled
            >
              {report.cursor ? "Check the next page" : "No more pages"}
            </Button>
          )}
        </div>

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

          {report && (
            <>
              <p className="text-muted-foreground">
                {`Judged ${report.judged} of ${report.read} GitHub-only ${
                  report.read === 1 ? "row" : "rows"
                }, walking newest first.`}
                {/* "Reached the oldest row", not "that is the whole
                    population": each page is its own transaction with ~200
                    GitHub fetches between them, and newest-first means a row
                    created mid-walk sorts ahead of where the walk started and
                    is never visited. What the data supports is where the walk
                    ended, which stays true either way. */}
                {report.cursor
                  ? " More pages remain."
                  : " That reached the oldest row."}
              </p>

              {report.mismatches.length === 0 ? (
                // Qualified whenever coverage is incomplete — rows that
                // couldn't be read, or pages not read yet. An unqualified
                // "none" over a partial walk is the false negative this whole
                // card exists to avoid, and paging makes a partial walk the
                // NORMAL first state rather than an edge case. A failed
                // continuation leaves the cursor in place, so its verdict stays
                // qualified too instead of standing clean beside the error.
                <p className="font-medium">
                  {report.unknown.length > 0 || report.cursor
                    ? `No mis-slugged rows among the ${report.judged} judged.`
                    : "No mis-slugged rows."}
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="font-medium text-destructive">
                    {report.mismatches.length} mis-slugged{" "}
                    {report.mismatches.length === 1 ? "row" : "rows"}:
                  </p>
                  <ul className="space-y-2">
                    {report.mismatches.map((m) => (
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

              {report.unknown.length > 0 && (
                <div className="space-y-1">
                  <p className="text-muted-foreground">
                    {report.unknown.length}{" "}
                    {report.unknown.length === 1 ? "row" : "rows"} couldn&apos;t
                    be judged. That is not the same as being wrong:
                  </p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {report.unknown.map((u) => (
                      <li key={`${u.source}/${u.skillId}`}>
                        <Link
                          href={skillDetailHref(u.source, u.skillId)}
                          target="_blank"
                          className="font-mono break-all underline underline-offset-2 hover:no-underline"
                        >
                          {u.source}/{u.skillId}
                        </Link>
                        {`: ${u.reason}`}
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
        <div className="mt-4">
          <SlugSwapNote typedSlug={typedSlug} slugId={candidate.skillId} />
        </div>
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

