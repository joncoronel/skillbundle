"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useConvexAuth } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import { parseSkillInput } from "@/lib/parse-skill-input";
import {
  addSkillErrorText,
  aliasRetryNote,
  alreadyInCatalogCopy,
  previewFailureCopy,
  typedSlugOf,
} from "@/lib/add-skill-copy";
import {
  busyButtonProps,
  useAddSkillFieldA11y,
} from "@/hooks/use-add-skill-field-a11y";
import {
  useAddSkillFlow,
  type AddSkillOutcome,
  type Candidate,
  type PreviewOkOf,
  type ReportHelpers,
} from "@/hooks/use-add-skill-flow";
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
import { SlugSwapNote } from "@/components/add-skill/slug-swap-note";
import { EntryPreview } from "@/components/add-skill/entry-preview";
import { cn } from "@/lib/utils";

// Derived from the server's return validator so the client can't drift from
// what the action actually sends (the review's finding on hand-declared
// shapes).
type PreviewOk = PreviewOkOf<typeof api.githubOnly.previewGitHubSkillPublic>;
type GitHubCandidate = Candidate<PreviewOk>;

// The outcome of a completed add, for the success card. `note` explains a
// non-obvious outcome — currently only the corrected-slug retry, where the
// skill that landed is named differently from the link that was pasted.
type Added = {
  kind: "skillssh" | "github";
  source: string;
  skillId: string;
  name: string;
  note?: string;
};

// An inline message shown under the form (already-in-catalog,
// couldn't-resolve, etc.). Rendered inside a persistent aria-live region so
// async outcomes are announced; tone drives the color. `link` adds a "View
// skill" affordance (already-in-catalog points at the existing row).
type Notice = {
  tone: "info" | "error";
  text: string;
  link?: { source: string; skillId: string };
};

export function AddSkillFlow({
  initialInput = "",
  autoFocus,
  onPendingChange,
  variant = "default",
}: {
  initialInput?: string;
  autoFocus?: boolean;
  // Reported so a container can refuse to unmount the flow mid-write. The
  // dialog uses it: dismissing after "Add to catalog" would otherwise complete
  // the insert and spend a quota slot with the confirmation thrown away.
  onPendingChange?: (pending: boolean) => void;
  /**
   * The Input variant for the substrate this flow is mounted on, passed through
   * verbatim. `default` paints an opaque `bg-input` (= `surface-3`), which is
   * right on the page but indistinguishable from the dialog: `DialogContent`
   * sits at `surface-5`, and in LIGHT mode `surface-3` and `surface-5` are both
   * pure white, so the field there had nothing but its hairline. (In dark they
   * differ, 0.264 vs 0.321, which is why the collapse only showed in one
   * theme.) `elevated` is the translucent variant that exists for this case.
   */
  variant?: "default" | "elevated";
}) {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const addManually = useAction(api.skills.addSkillManuallyPublic);
  const previewGitHub = useAction(api.githubOnly.previewGitHubSkillPublic);
  const addFromGitHub = useAction(api.githubOnly.addSkillFromGitHubPublic);

  const [added, setAdded] = useState<Added | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  // The form is the permanent shell: signed-out visitors keep the input (and
  // anything they've typed/pasted) and only the submit affordance swaps to a
  // sign-in button. Swapping the whole tree after auth resolves would destroy
  // an autofocused field mid-typing.
  const signedOut = !authLoading && !isAuthenticated;

  // Declared ABOVE `report`, which calls it. As a `function` below it this was a
  // lint error ("cannot access variable before it is declared") even though a
  // declaration would hoist — the same temporal-dead-zone shape that bit the
  // quota backstop when it tried to close over the hook's return value.
  const focusInput = useCallback(() => {
    document.getElementById("add-skill-input")?.focus();
  }, []);

  // Every terminal point of the protocol, rendered as this surface's inline
  // aria-live notice / success card. The sequencing that produces these lives
  // in the hook; only the presentation is here.
  const report = useCallback(
    (
      outcome: AddSkillOutcome<PreviewOk>,
      { patchCandidate }: ReportHelpers<PreviewOk>,
    ) => {
      switch (outcome.kind) {
        case "submitting":
          setNotice(null);
          setAdded(null);
          return;
        case "added":
          setNotice(null);
          setAdded({
            kind: "skillssh",
            source: outcome.result.source,
            skillId: outcome.result.skillId,
            name: outcome.result.name,
            note: outcome.viaAlias
              ? aliasRetryNote(outcome.viaAlias.skillId)
              : undefined,
          });
          // The step-3 alias re-add reached from a CONFIRM unmounts the card the
          // user was standing in. Conditional for the same reason
          // `already_exists` is: on the plain-submit path no card existed and the
          // submit button is still mounted.
          if (outcome.candidateDismissed) focusInput();
          return;
        case "github_added":
          setNotice(null);
          setAdded({
            kind: "github",
            source: outcome.result.source,
            skillId: outcome.result.skillId,
            name: outcome.result.name,
          });
          // Same hazard the Cancel handler below already guards, on the other exit
          // from the same card: the focused Confirm button unmounts with it.
          // Unconditional, unlike `already_exists`, because this outcome can only
          // come from `confirmGitHub` — which returns early without a candidate, so
          // a card was always mounted. The input stays mounted above the success
          // card, so it is the right place to land.
          focusInput();
          return;
        case "already_exists":
          // Names the slug it lives under, which on the alias path is NOT the one
          // that was typed. Shared with the admin surface so the two can't drift.
          setNotice({
            tone: "info",
            text: alreadyInCatalogCopy(outcome),
            link: { source: outcome.source, skillId: outcome.skillId },
          });
          // Same reason as the Cancel handler below: when this outcome drops the
          // confirm card, the button the user just pressed unmounts with it. Only
          // when it actually dropped one — otherwise this would yank focus off a
          // submit button that is still sitting there.
          if (outcome.candidateDismissed) focusInput();
          return;
        case "candidate":
          // The card mounts as a sibling OUTSIDE the live region, so without a
          // notice a screen-reader user hears the pending label stop and then
          // silence — with no signal that a confirmation step now gates the flow.
          setNotice({
            tone: "info",
            text: `Found ${outcome.preview.path} in the repo. Review and confirm below.`,
          });
          return;
        case "preview_failed":
          setNotice({
            tone: "error",
            text: previewFailureCopy(outcome.preview),
          });
          return;
        // This surface doesn't distinguish a GitHub-side failure from any other:
        // both reach the same notice with the same friendly text. The admin form
        // does, which is why the hook reports them separately.
        case "preview_threw":
        case "failed": {
          const err = outcome.error;
          if (isQuotaError(err)) {
            // Race backstop: the server enforces the quota atomically inside the
            // insert. When it rejects a stale confirm, flip the candidate's own
            // snapshot too so the card swaps to its upgrade state instead of
            // leaving an enabled button that keeps failing. wasDelisted flips
            // with it: relists never hit the gate, so a quota error PROVES the
            // insert was genuine and any relist marker from preview time is stale.
            patchCandidate((c) => ({
              ...c,
              wasDelisted: false,
              quota: { ...c.quota, atLimit: true },
            }));
            setNotice({ tone: "error", text: quotaErrorText(err) });
            // `atLimit` flips `blocked`, which replaces the whole button row with
            // the upgrade banner — so the Confirm the user just pressed unmounts
            // and focus would fall to <body>. The sibling refusal path
            // (`preview_failed`) needs no such call: it leaves the card mounted, so
            // `focusableWhenDisabled` on Confirm holds focus where it already is.
            focusInput();
            return;
          }
          setNotice({ tone: "error", text: addSkillErrorText(err) });
          return;
        }
        default:
          // TS checks a switch for exhaustiveness only against a declared type;
          // a void-returning function with bare `return`s gets no check at all.
          // This line is what makes a new AddSkillOutcome arm a compile error
          // here instead of a terminal point that silently renders nothing.
          outcome satisfies never;
      }
    },
    [focusInput],
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
  } = useAddSkillFlow<PreviewOk>({
    initialInput,
    addManually,
    previewGitHub,
    addFromGitHub,
    report,
  });

  useEffect(() => {
    onPendingChange?.(pending);
  }, [pending, onPendingChange]);

  // One writer for the field, shared by typing and by the readout's example
  // rows. `changeInput`, never `setInput`, so a pending candidate is
  // invalidated; and both displays are cleared for the reason the onChange
  // handler already cleared them — either one otherwise keeps reporting on the
  // previous skill inside the live region that is about to report on this one.
  function writeInput(value: string) {
    changeInput(value);
    if (notice) setNotice(null);
    if (added) setAdded(null);
  }

  // `submitBlocked` conflates three unrelated reasons and only `pending` changes
  // the button's label, so a keyboard user would otherwise land on "Add skill,
  // unavailable" with no way to know which applies. The wording is this
  // surface's; the contract that makes the button reachable at all is shared.
  const { inputProps, submitProps, reasonProps } = useAddSkillFieldA11y({
    pending,
    blocked: submitBlocked || authLoading,
    reasonText:
      // `&& !submitBlocked` is load-bearing: `submitBlocked` is true whenever the
      // field is empty and `authLoading` is true on every cold load, so without it
      // the OPENING state of /add reads "Checking your sign-in…" instead of the
      // actionable "Paste a skill link…", then swaps silently once Clerk resolves
      // (an `aria-describedby` change on a focused element is not re-announced).
      // The auth reason is only worth showing when it is the ONLY thing blocking.
      authLoading && !submitBlocked
        ? "Checking your sign-in…"
        : !input.trim()
          ? "Paste a skill link or source first."
          : "Review the file found below, then confirm it.",
  });

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // The auth guards mirror the button state, and come first: a signed-out
    // Enter-press takes the same path as clicking the visible "Sign in to add"
    // button even with an empty field. While auth is still resolving nothing
    // fires — an action called before the token lands errors even for a
    // signed-in user.
    if (signedOut) {
      const path = window.location.pathname + window.location.search;
      router.push(signInUrl(path));
      return;
    }
    if (authLoading || !isAuthenticated) return;

    const trimmed = input.trim();
    // Validate the input shape client-side before hitting the action, so a
    // typo never reaches the server (Convex forwards server throws to the dev
    // console). The action re-validates as defense-in-depth.
    if (trimmed) {
      try {
        parseSkillInput(trimmed);
      } catch (err) {
        setNotice({ tone: "error", text: addSkillErrorText(err) });
        return;
      }
    }
    await submit(trimmed);
  }

  // The page mounts the flow inside an inset frame (the home page's composer
  // language: a muted gutter with the field and the preview lifted inside it),
  // the dialog mounts it bare on its own muted body. `variant` already names
  // that substrate for the field; the frame follows it.
  const framed = variant === "default";
  const action = signedOut ? (
    <Button
      type="button"
      variant="neutral"
      size="lg"
      className="mt-1 w-full sm:col-start-2 sm:row-start-1 sm:mt-0"
      onClick={() => {
        const path = window.location.pathname + window.location.search;
        router.push(signInUrl(path));
      }}
    >
      Sign in to add
    </Button>
  ) : (
    <Button
      type="submit"
      variant="neutral"
      size="lg"
      {...submitProps}
      className="mt-1 w-full sm:col-start-2 sm:row-start-1 sm:mt-0"
    >
      {label ?? "Add skill"}
    </Button>
  );

  return (
    <div className="space-y-5">
      <form onSubmit={handleSubmit}>
        {/* Visually hidden: the page title and the frame already name the one
            field, and a caption above the instrument read as a form label on
            a form. Still a real label for the accessible name. */}
        <Label htmlFor="add-skill-input" className="sr-only">
          Skill link or source
        </Label>
        {/* Hidden too, and permanent, so `aria-describedby` below always
            resolves. The preview's visible empty state says the same thing in
            its own words but unmounts once something parses. */}
        <p id="add-skill-help" className="sr-only">
          A skills.sh URL, a GitHub link to the skill&apos;s folder, or the
          owner/repo/slug short form.
        </p>
        <Frame framed={framed}>
          {/* Grid rather than a flex row, so the action sits BESIDE the field
              from `sm` up and under it below, in one gutter's width of gap
              (`gap-1` = the frame's own 4px padding, so the seams match). */}
          {/* The action track is FIXED, not `auto`. Sized to the widest label
              the button can hold (measured: "Checking GitHub…" at 145px),
              because an auto track sizes to max-content and one submit walks
              through three labels, so the field shrank and re-expanded
              mid-request, re-truncating the URL under the user's cursor. It
              also absorbs the signed-out → signed-in label swap on load. */}
          <div
            className={cn(
              "sm:grid sm:grid-cols-[minmax(0,1fr)_9.25rem]",
              framed ? "sm:gap-x-1" : "sm:gap-x-2",
            )}
          >
            <Input
              id="add-skill-input"
              type="text"
              variant={variant}
              // The skills.sh form, not the GitHub one, for length: a valid
              // GitHub deep link needs `/tree/<branch>/` and truncates past
              // its own point on a phone. This one is 39 characters and still
              // carries the scheme, which is the part that matters. All three
              // forms are one click away in the preview below.
              placeholder="https://skills.sh/owner/repo/skill-name"
              // Mono because the field's entire content is a machine string
              // that was pasted. h-11/h-10 is one step up the shared
              // Input/Button ramp and is matched by the button's `lg` size.
              // Inside the frame the field drops its hairline for the surface
              // shadow, exactly as the home composer's field does: the muted
              // gutter is the edge now.
              className={cn(
                "h-11 font-mono sm:col-start-1 sm:row-start-1 sm:h-10",
                framed &&
                  "border-0 shadow-[var(--surface-shadow-3),var(--surface-rim-3)]",
              )}
              value={input}
              onChange={(e) => {
                // writeInput also invalidates a pending candidate so its
                // Confirm can't add the previous input.
                writeInput(e.target.value);
              }}
              {...inputProps}
              aria-invalid={notice?.tone === "error" || undefined}
              // Both, space-separated: the help sentence states what the field
              // accepts, so anyone tabbing straight to the field hears it.
              aria-describedby="add-skill-help add-skill-notice"
              autoFocus={autoFocus}
            />
            {action}
          </div>
          <div className={framed ? "mt-1" : "mt-3"}>
            <EntryPreview
              input={input}
              pending={pending}
              framed={framed}
              onUseExample={(value) => {
                writeInput(value);
                // The chip that was just clicked unmounts with the empty
                // frame it lives in, so focus would fall to <body>, the same
                // hazard every card exit in this file guards. The field is
                // also simply where you want to be next.
                focusInput();
              }}
            />
          </div>
        </Frame>
        {/* Why the button is unavailable, for the tab stop it now always is.
            Outside the live region below on purpose: this is a description of
            a control, not an event to announce. Only in the signed-in branch:
            the signed-out one renders a "Sign in to add" button that carries
            no `aria-describedby`. */}
        {!signedOut && reasonProps && <p {...reasonProps} />}
      </form>

      {/* Persistent live region: async outcomes (errors, info, success) are
          announced to screen readers instead of appearing silently after the
          button re-enables. */}
      <div role="status" aria-live="polite" className="space-y-5">
        {/* The submit button's label is the only progress signal, and one
            submit can run three sequential round-trips. This mirror covers the
            case where focus is NOT on the button — Enter from the readOnly
            input leaves focus in the input, which is the common path — where
            the label change would otherwise go unannounced entirely.

            It used to say the button "sits on a disabled, unfocused control".
            Half of that stopped being true when the button gained
            `focusableWhenDisabled`: when it IS focused, its accessible name
            walks the same phases this region announces, so some screen readers
            will read each phase twice. That duplication is the accepted cost of
            not going silent on the common path. */}
        {label && <p className="sr-only">{label}</p>}
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
          {notice?.link && (
            <>
              {" "}
              <Link
                href={skillHref(notice.link.source, notice.link.skillId)}
                className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
              >
                View skill
              </Link>
            </>
          )}
        </p>

        {added && <SuccessCard added={added} />}
      </div>

      {candidate && (
        <GitHubCandidateCard
          candidate={candidate}
          confirming={confirming}
          disabled={pending}
          onConfirm={confirmGitHub}
          onCancel={() => {
            clearCandidate();
            // The focused Cancel button unmounts with the card; put focus
            // somewhere useful instead of letting it fall to <body>.
            focusInput();
          }}
        />
      )}
    </div>
  );
}

/**
 * The instrument's body on the page: an inset Card, the same object the home
 * page's search composer is. Its muted gutter is what separates the field and
 * the preview from the page, so both drop their hairlines inside it. In the
 * dialog there is no frame: the dialog's body is already the muted ground.
 */
function Frame({
  framed,
  children,
}: {
  framed: boolean;
  children: React.ReactNode;
}) {
  if (!framed) return <>{children}</>;
  return <Card variant="inset">{children}</Card>;
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
  // The slug is the one field the server can change out from under the pasted
  // link (it prefers the SKILL.md's frontmatter name over the folder name), so
  // the card names it and explains any swap. Without this the only
  // identifier-shaped row shown is File — which advertises the folder name
  // that will NOT be used.
  const typedSlug = typedSlugOf(candidate.input);
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
          <dt className="text-muted-foreground">Slug</dt>
          <dd className="truncate font-mono text-xs">{candidate.skillId}</dd>
          <dt className="text-muted-foreground">File</dt>
          <dd className="truncate font-mono text-xs">{candidate.path}</dd>
          {candidate.description && (
            <>
              <dt className="text-muted-foreground">Description</dt>
              <dd>{candidate.description}</dd>
            </>
          )}
        </dl>
        <SlugSwapNote typedSlug={typedSlug} slugId={candidate.skillId} />
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
            {/*
              Same reason as the submit button: a natively disabled control
              cannot hold focus, and the user is standing ON this one when they
              activate it. Confirm is the LONGER request of the two — it can
              spawn the step-3 alias re-add, so two sequential round trips with
              the card still mounted. `inFlight` is the double-activation guard,
              not the attribute.
            */}
            <Button
              onClick={onConfirm}
              disabled={disabled}
              {...busyButtonProps({ inFlight: confirming })}
            >
              {confirming ? "Adding…" : "Add to catalog"}
            </Button>
            <Button
              variant="outline"
              onClick={onCancel}
              disabled={disabled}
              {...busyButtonProps({ inFlight: false })}
            >
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
          {added.note && (
            <p className="text-xs text-muted-foreground">{added.note}</p>
          )}
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
