"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useConvex, useConvexAuth } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { convexErrorMessage } from "@/lib/convex-error";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  CheckmarkBadge01Icon,
  GithubIcon,
  SquareLock02Icon,
} from "@hugeicons/core-free-icons";
import {
  ANON_DAILY_ANALYSES,
  ANON_LIMIT,
  currentMonth,
  EXAMPLE_REPO_SLUG,
  EXAMPLE_REPO_URL,
  extractRepoSlug,
  FREE_LIMIT,
  FREE_MONTHLY_REPOS,
  matchesDemoRepo,
  repoMatchKey,
  repoMatchMeter,
  SIGN_IN_REQUIRED,
  BOT_REFUSED,
  SIGNED_OUT_UNAVAILABLE,
} from "@/lib/repo-match";
import { signInUrl } from "@/components/auth/shared";
import { analyzeRepoSignedOut } from "@/app/(main)/actions";
import { Button } from "@/components/ui/cubby-ui/button";
import { Toggle } from "@/components/ui/cubby-ui/toggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/cubby-ui/select";
import { api } from "@/convex/_generated/api";
import type { AnalyzeRepoResult } from "@/convex/recommendations";
import {
  rowPositionClassName,
  SelectableSkillRow,
  type SkillData,
} from "@/components/skill-card";
import { useExplorerState } from "@/components/explorer-state";
import { RepoPicker } from "@/components/repo-picker";
import { useUserPlan } from "@/hooks/use-user-plan";
import { Skeleton } from "@/components/ui/cubby-ui/skeleton/skeleton";
import { Crossfade } from "@/components/ui/cubby-ui/crossfade";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/cubby-ui/collapsible";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics";
type GroupedRecommendation = AnalyzeRepoResult["recommendations"][number];

// Refusals that signing in fixes (besides ANON_LIMIT, which has its own copy).
const SIGN_IN_CODES: ReadonlySet<string> = new Set([
  SIGN_IN_REQUIRED,
  BOT_REFUSED,
  SIGNED_OUT_UNAVAILABLE,
]);

// Fingerprint languages arrive lowercased from the GitHub API mapping;
// display-case the common ones (fallback: capitalize the first letter).
const LANGUAGE_DISPLAY: Record<string, string> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  css: "CSS",
  html: "HTML",
  php: "PHP",
  "c#": "C#",
  "c++": "C++",
};
function displayLanguage(lang: string) {
  return (
    LANGUAGE_DISPLAY[lang.toLowerCase()] ??
    lang.charAt(0).toUpperCase() + lang.slice(1)
  );
}

/** Best install count in a group — the sort key for "Most installed". */
function groupInstalls(group: GroupedRecommendation) {
  return Math.max(...group.variants.map((v) => v.installs));
}

function groupIsOfficial(group: GroupedRecommendation) {
  return group.variants.some((v) => v.curatedOwner);
}

/**
 * Fetches repo analysis results via TanStack Query, keyed on the repo URL
 * param. The URL is only set when the user clicks Analyze, so typing in the
 * input doesn't trigger fetches. Tab switches don't re-fetch, and
 * re-analyzing the same repo is a cache hit.
 *
 * Reads its own state from context/hooks (repo URL + the plan) rather than
 * props — same convention as the composer chins — so nothing is drilled
 * through the explorer tree.
 */
export function RepoAnalysisResults() {
  const convex = useConvex();
  const { repoUrl, setParams } = useExplorerState();
  const { isAuthenticated } = useConvexAuth();
  const {
    limits,
    isLoading: planLoading,
    isAuthLoading,
    isPlanError,
  } = useUserPlan();
  // The free account's monthly allowance; null for signed-out and Pro.
  const { data: usageAnswer } = useQuery({
    ...convexQuery(api.repoMatchQuota.myUsage, isAuthenticated ? {} : "skip"),
    enabled: isAuthenticated,
  });
  // The subscription doesn't re-run when the month rolls over, so an answer
  // for an earlier month means a fresh month.
  const usage =
    usageAnswer && usageAnswer.month !== currentMonth()
      ? { ...usageAnswer, used: 0, repos: [] }
      : usageAnswer;

  // Result narrowing — local state, not URL state: it scopes one analysis
  // view, resets naturally with the component, and repo links shared without
  // it still show the full picture.
  const [officialOnly, setOfficialOnly] = useState(false);
  const [resultSort, setResultSort] = useState<"match" | "installs">("match");

  const trimmedUrl = repoUrl.trim();
  const parsed = extractRepoSlug(trimmedUrl);

  // Parseability is orthogonal to the allowance: a submitted value the parser
  // can't read at all (only reachable via a hand-edited or stale pre-parser
  // shared link — the composer validates on submit) is an invalid-URL error for
  // everyone, handled below before any gating.
  const invalidUrl = !!trimmedUrl && !parsed;

  const isExample = parsed ? matchesDemoRepo(parsed.owner, parsed.repo) : false;
  const canAutoDetect = limits?.canAutoDetect ?? false;

  // "This user is free" — the plan has resolved (not loading, and not errored:
  // an error is "unknown", not "free", so a Pro user whose plan query blipped
  // isn't shown a free user's copy) and doesn't grant auto-detect. Signed-out
  // visitors count: their plan resolves to free without a query.
  const planResolvedFree = !planLoading && !isPlanError && !canAutoDetect;

  // The Pro mirror. Gates the repo picker in the empty state, so it can never
  // flash at a free user mid plan-load.
  const planResolvedPro = !planLoading && !isPlanError && canAutoDetect;

  // Which allowance this repo draws on, via the SAME predicate the server
  // enforces, so the client's routing and copy can't drift from its gate.
  // Null until the caller is known.
  const meter =
    parsed && !planLoading && !isPlanError
      ? repoMatchMeter(
          { signedIn: isAuthenticated, canAutoDetect },
          parsed.owner,
          parsed.repo,
        )
      : null;
  const freeLeft =
    usage && planResolvedFree
      ? { left: Math.max(0, usage.limit - usage.used), limit: usage.limit }
      : null;

  // Out of repos and asking for a new one: the server would refuse, so skip
  // the round-trip. Re-running a counted repo stays allowed.
  const knownOverQuota =
    meter === "monthly" &&
    !!usage &&
    !!parsed &&
    usage.used >= usage.limit &&
    !usage.repos.includes(repoMatchKey(parsed.owner, parsed.repo));

  // Fire as soon as auth is known, not once the plan is: the server is the
  // gate, and a Pro user's deep link shouldn't wait on the plan query.
  const canFetch =
    !!parsed && (isExample || (!isAuthLoading && !knownOverQuota));

  const { data, isPending, error } = useQuery<AnalyzeRepoResult>({
    queryKey: ["repo", "analyze", trimmedUrl],
    queryFn: async () => {
      // In `queryFn` rather than on the submit handler, so it counts runs that
      // actually reach the server. A cache hit inside `staleTime` does not call
      // this, which is correct: no GitHub walk happened, so no run happened.
      // `isExample` separates the free demo from real usage — conflating them
      // would make the feature look far more used than it is. The URL itself
      // is never sent; it can name a private org.
      track("repo_match_run", { demo: isExample, signedIn: isAuthenticated });
      if (!isExample && !isAuthenticated) {
        // Metered per IP by the site. Server action errors are masked in
        // production, so it returns refusals and they are rethrown here.
        const res = await analyzeRepoSignedOut(trimmedUrl);
        if (!res.ok) {
          throw new ConvexError({ code: res.code, message: res.message });
        }
        return res.result;
      }
      return convex.action(api.recommendations.analyzeRepo, {
        repoUrl: trimmedUrl,
      });
    },
    enabled: canFetch,
    staleTime: 10 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
  });

  const tryExample = () => setParams({ repoUrl: EXAMPLE_REPO_URL });

  // Refusals arrive as the query error (never cached data), each mapped to
  // the prompt that fixes it; anything else is the generic error card.
  const errorCode =
    error instanceof ConvexError
      ? (error.data as { code?: string } | undefined)?.code
      : undefined;
  const wall: RepoMatchWallKind | null =
    knownOverQuota || errorCode === FREE_LIMIT
      ? "upgrade"
      : errorCode === ANON_LIMIT
        ? "anon-limit"
        : errorCode && SIGN_IN_CODES.has(errorCode)
          ? "sign-in"
          : null;

  const analyzing = isPending && canFetch;

  // Skeleton while a fetch is in flight, or while auth decides which path it
  // takes. An unparseable input skips straight to the error card.
  const loading =
    analyzing || (!!parsed && !isExample && !wall && isAuthLoading);

  // Refusals have their own prompt, not this card. An unparseable input gets
  // the server's invalid-URL error without the round-trip.
  const actionError = wall
    ? null
    : invalidUrl
      ? "Invalid GitHub URL"
      : error
        ? convexErrorMessage(error) ||
          error.message ||
          "Something went wrong analyzing this repository. Please try again."
        : (data?.error ?? null);

  if (loading) {
    const rowCount = 6;
    // Skeleton mirrors the three regions analysis renders — detected-in
    // line, results header, joined recommendation rows — so nothing shifts
    // when results land. Repo analysis hits GitHub and can take a few
    // seconds, and repo mode has no input spinner, so the header carries a
    // visible "Analyzing…" status for the wait rather than leaving it silent.
    //
    // Only claim "Analyzing…" while a request is in flight; the line's space
    // is reserved so nothing shifts. Conditionally rendered so the live region
    // announces it only once it's true.
    return (
      <div className="mt-4" aria-busy="true">
        <p role="status" className="mb-4 min-h-4 text-xs text-muted-foreground">
          {analyzing && (
            <span className="transition-opacity duration-240 ease-out-cubic motion-reduce:transition-none starting:opacity-0">
              Analyzing repository…
            </span>
          )}
        </p>
        <Skeleton className="mb-3 h-3 w-48 rounded-sm" aria-hidden="true" />
        <div className="grid grid-cols-1" aria-hidden="true">
          {Array.from({ length: rowCount }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "flex items-center gap-3 rounded-2xl border bg-card px-4 py-3 dark:border-border/50",
                rowPositionClassName(i, rowCount),
              )}
            >
              <Skeleton className="size-4 shrink-0 rounded-sm" />
              <div className="flex items-baseline gap-x-2">
                <Skeleton
                  className={cn(
                    "h-5 rounded-sm",
                    i % 2 === 0 ? "w-32" : "w-24",
                  )}
                />
                <Skeleton
                  className={cn(
                    "h-4 rounded-sm",
                    i % 3 === 0 ? "w-24" : "w-16",
                  )}
                />
              </div>
              <Skeleton className="ml-auto h-4 w-12 shrink-0 rounded-sm" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (actionError) {
    // Same card treatment as the empty state, so the failure doesn't float in
    // a void — and it says what to try, not just what broke. role=alert gets
    // it announced when it lands.
    return (
      <div
        role="alert"
        className="mt-4 rounded-xl border border-dashed border-border px-6 py-10 text-center"
      >
        <p className="text-sm font-medium text-destructive">{actionError}</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Double-check the URL — like github.com/vercel/next.js. Private repos
          need your GitHub account connected.
        </p>
      </div>
    );
  }

  // No result yet: the empty state, or the refusal prompt, which takes
  // precedence over any in-flight or errored query.
  if (!data || wall) {
    return (
      <Crossfade active={!!wall}>
        <RepoMatchEmptyState
          onTryExample={tryExample}
          freeLeft={freeLeft}
          showPicker={planResolvedPro}
        />
        <RepoMatchWall kind={wall ?? "upgrade"} onTryExample={tryExample} />
      </Crossfade>
    );
  }

  const result = data;

  const recs = result.recommendations;
  const fingerprint = result.fingerprint;

  if (recs.length === 0) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        No matching skills found for {result.repoName}.
      </p>
    );
  }

  // Narrow + reorder client-side: the analysis already returned everything,
  // so these are instant. "Best match" preserves the server's composite
  // ranking; "Most installed" reorders by each group's best variant
  // (decorate-sort so groupInstalls runs once per group, not per comparison).
  let shownGroups = officialOnly ? recs.filter(groupIsOfficial) : recs;
  if (resultSort === "installs") {
    shownGroups = shownGroups
      .map((group) => [groupInstalls(group), group] as const)
      .sort((a, b) => b[0] - a[0])
      .map(([, group]) => group);
  }

  return (
    <div className="mt-4">
      {/* One quiet line confirming WHAT got analyzed (matters when the typed
          URL resolves to a different canonical name, or the analysis came
          from a shared ?repo= link). No chip dump and no per-row package
          notes — the matching is semantic, and the results header names that
          honestly; matchedPackages stays in the payload for a future home in
          the skill detail sheet. */}
      {fingerprint && (
        <p className="mb-4 text-xs text-muted-foreground">
          Detected in {result.repoName}
          {fingerprint.languages.length > 0 &&
            ` · ${fingerprint.languages.map(displayLanguage).join(", ")}`}
          {fingerprint.packages.length > 0 &&
            ` · ${fingerprint.packages.length} packages read`}
        </p>
      )}

      {/* Results header: the count doubles as a live region so narrowing is
          announced, and the microcopy names HOW these were picked — matches
          are semantic (stack similarity), not keyword hits. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <p
          className="text-xs text-muted-foreground tabular-nums"
          role="status"
          aria-live="polite"
        >
          {officialOnly || resultSort !== "match"
            ? `${shownGroups.length} of ${recs.length} recommended skills`
            : `${recs.length} recommended skill${recs.length !== 1 ? "s" : ""}`}{" "}
          · ranked by similarity to this stack
        </p>
        <div className="flex items-center gap-1">
          <Toggle
            variant="outline"
            size="sm"
            pressed={officialOnly}
            onPressedChange={setOfficialOnly}
            aria-label="Official skills only"
            className="text-sm"
          >
            <HugeiconsIcon
              icon={CheckmarkBadge01Icon}
              strokeWidth={2}
              className={cn(
                "size-3.5",
                officialOnly ? "text-info-foreground" : "text-muted-foreground",
              )}
            />
            Official
          </Toggle>
          <Select
            value={resultSort}
            onValueChange={(v) => {
              if (v) setResultSort(v as "match" | "installs");
            }}
            items={{ match: "Best match", installs: "Most installed" }}
          >
            <SelectTrigger
              size="sm"
              variant="ghost"
              aria-label="Sort matches"
              className="-me-2"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger>
              <SelectItem value="match">Best match</SelectItem>
              <SelectItem value="installs">Most installed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {shownGroups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          None of these matches are official skills. Turn off the Official
          filter to see all {recs.length}.
        </p>
      ) : (
        /* grid-cols-1 (minmax(0,1fr)) keeps the track shrinkable — a bare
           `grid` sizes its implicit track to the widest row's intrinsic width,
           overflowing the viewport on mobile instead of letting the rows'
           internal truncation kick in. Same pattern as SkillRowGrid. */
        <div className="grid grid-cols-1">
          {shownGroups.map((group, i) => {
            const positionClassName = rowPositionClassName(
              i,
              shownGroups.length,
            );

            if (group.variantCount === 1) {
              const variant = group.variants[0];
              // The variant is structurally a SkillData minus `name`, which
              // lives on the group.
              const skill: SkillData = { ...variant, name: group.name };
              return (
                <SelectableSkillRow
                  key={`singleton:${variant.source}/${variant.skillId}`}
                  skill={skill}
                  className={positionClassName}
                />
              );
            }

            return (
              <SkillGroupRow
                key={`group:${group.name}`}
                group={group}
                className={positionClassName}
              />
            );
          })}
        </div>
      )}

      {/* The demo is the taste; this is the ask. Only when a resolved-free user
          is looking at the example — gated on planResolvedFree (not a lone
          !canAutoDetect) so it can't flash at a Pro user mid plan-load. */}
      {planResolvedFree && isExample && (
        <p className="mt-4 text-xs text-muted-foreground">
          This is the {EXAMPLE_REPO_SLUG} example. Paste a link to your own repo
          above to match it.
        </p>
      )}
      {!isExample && meter === "monthly" && freeLeft && (
        <p className="mt-4 text-xs text-muted-foreground tabular-nums">
          <FreeLeftLine {...freeLeft} />
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pre-analysis variants — the two states the Crossfade swaps between
// ---------------------------------------------------------------------------

/**
 * The teaching empty state: what Analyze does, a one-click demo, and for a
 * free account how many repo matches are left this month.
 */
function RepoMatchEmptyState({
  onTryExample,
  freeLeft,
  showPicker,
}: {
  onTryExample: () => void;
  /** A free account's remaining monthly repos; null when nothing is counted. */
  freeLeft: { left: number; limit: number } | null;
  /** Resolved-Pro users get the connect-GitHub / pick-a-repo affordance. */
  showPicker: boolean;
}) {
  return (
    <div className="mt-4 rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <HugeiconsIcon
        icon={GithubIcon}
        strokeWidth={1.5}
        className="mx-auto size-6 text-muted-foreground/50"
      />
      <p className="mt-3 text-sm font-medium">Get skills matched to a repo</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        Paste a GitHub repo URL and Analyze reads its languages and packages,
        then recommends skills that fit the stack.
      </p>
      {/* Fades in once the plan resolves Pro, so free users' layout never
          jumps. Space isn't reserved — the picker is an upgrade to the card,
          not a hole in it. */}
      {showPicker && (
        <div className="transition-opacity duration-240 ease-out-cubic motion-reduce:transition-none starting:opacity-0">
          <RepoPicker />
        </div>
      )}
      {/* Future home of the RECENT list (previously analyzed repos + match
          counts) — sits between the picker and the example button. */}
      <Button
        variant={showPicker ? "ghost" : "outline"}
        size="sm"
        className={cn("mt-4", showPicker && "text-muted-foreground")}
        onClick={onTryExample}
      >
        Try it on {EXAMPLE_REPO_SLUG}
      </Button>
      {freeLeft && (
        <p className="mt-4 text-xs text-muted-foreground tabular-nums">
          <FreeLeftLine {...freeLeft} />{" "}
          <Link href="/pricing" className="underline hover:text-foreground">
            Pro
          </Link>{" "}
          is unlimited.
        </p>
      )}
    </div>
  );
}

/** "2 of 5 free repo matches left this month." */
function FreeLeftLine({ left, limit }: { left: number; limit: number }) {
  return left > 0 ? (
    <>
      {left} of {limit} free repo matches left this month.
    </>
  ) : (
    <>You&apos;ve used your {limit} free repo matches this month.</>
  );
}

type RepoMatchWallKind = "upgrade" | "anon-limit" | "sign-in";

/**
 * An allowance refusal, inline in the results region. Each kind offers the
 * one thing that fixes it (Pro, or signing in), and the demo stays one click
 * away.
 */
function RepoMatchWall({
  kind,
  onTryExample,
}: {
  kind: RepoMatchWallKind;
  onTryExample: () => void;
}) {
  const router = useRouter();
  const signIn = () => {
    // Read here, not via useSearchParams, which would make the page dynamic.
    const { pathname, search } = window.location;
    router.push(signInUrl(pathname + search));
  };

  const copy: Record<RepoMatchWallKind, { title: string; body: string }> = {
    upgrade: {
      title: `You've matched ${FREE_MONTHLY_REPOS} repos this month`,
      body: `Free accounts can match ${FREE_MONTHLY_REPOS} repos a month, and re-running one you've already matched doesn't count. Your count resets at the start of next month. Pro matches as many as you like.`,
    },
    "anon-limit": {
      title: "You've used your free matches for now",
      body: `Signed out, you get ${ANON_DAILY_ANALYSES} new repo matches a day. Sign in to match ${FREE_MONTHLY_REPOS} repos a month on a free account.`,
    },
    "sign-in": {
      title: "Sign in to match your repo",
      body: `A free account can match ${FREE_MONTHLY_REPOS} repos a month.`,
    },
  };
  const { title, body } = copy[kind];

  return (
    <div className="mt-4 rounded-2xl border bg-card px-6 py-10 text-center">
      <HugeiconsIcon
        icon={SquareLock02Icon}
        strokeWidth={1.5}
        className="mx-auto size-6 text-muted-foreground/60"
      />
      {/* Announced when the Crossfade reveals it. */}
      <div role="alert">
        <p className="mt-3 text-sm font-medium">{title}</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          {body}
        </p>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {kind === "upgrade" ? (
          <Button
            nativeButton={false}
            variant="primary"
            size="sm"
            render={<Link href="/pricing" />}
          >
            Upgrade to Pro
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={signIn}>
            Sign in
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onTryExample}>
          Try the example
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group row — collapsible row for skills with multiple variants
// ---------------------------------------------------------------------------

interface SkillGroupRowProps {
  group: GroupedRecommendation;
  className?: string;
}

function SkillGroupRow({ group, className }: SkillGroupRowProps) {
  const visibleCount = group.variants.length;
  const cappedRemainder = group.variantCount - visibleCount;

  return (
    <Collapsible
      className={cn(
        "flex flex-col rounded-2xl border bg-card text-card-foreground dark:border-border/50",
        // overflow-hidden lets the outer rounded-2xl clip the inner muted
        // section's square corners, so we don't need to round each child.
        "overflow-hidden",
        "transition-colors",
        // Selection-border continuity at group boundaries: colour the group's
        // bottom border when followed by a checked singleton. Every row's only
        // border is its bottom one, so the group's bottom edge IS the seam
        // above that singleton.
        "[&:has(+_label_[data-checked])]:border-b-primary/30",
        className,
      )}
    >
      <CollapsibleTrigger
        className={cn(
          "border-none bg-transparent shadow-none ring-0 hover:bg-transparent hover:opacity-80",
          "w-full px-4 py-3",
        )}
      >
        <div className="flex w-full items-center gap-3">
          <span className="min-w-0 truncate text-left text-sm font-semibold">
            {group.name}
          </span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
            {group.variantCount} versions
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            strokeWidth={2}
            className="size-4 text-muted-foreground transition-transform duration-200 group-data-panel-open/collapsible:rotate-180"
          />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="max-sm:duration-0">
        {/* Nested section: muted background visually shows that variants
            are children of the group row above. Each variant is rendered
            as a SelectableSkillRow so it inherits the same checkbox +
            click-row vs click-name behavior the singleton rows use.

            The `border-t` is the visual top edge of the first variant
            (since variants have border-t-0). Color it orange when the
            first variant is selected so the selection's top edge visually
            connects to the rest of its border. */}
        <div className="border-t bg-muted dark:border-border/50 [&:has(>_label:first-child[data-checked])]:border-t-primary/30">
          {group.variants.map((variant, i) => {
            const skill: SkillData = { ...variant, name: group.name };
            const isLast = i === group.variants.length - 1;
            return (
              <SelectableSkillRow
                key={`${variant.source}/${variant.skillId}`}
                skill={skill}
                className={cn(
                  // Square the corners and remove the standalone card border
                  // so variants render as one continuous list inside the
                  // expanded section. The bottom-most variant retains the
                  // bottom-rounding from the wrapper div.
                  "rounded-none border-x-0 border-t-0 bg-transparent",
                  isLast && cappedRemainder === 0 && "border-b-0",
                )}
              />
            );
          })}
          {cappedRemainder > 0 && (
            <div className="px-4 py-2 text-xs text-muted-foreground">
              showing {visibleCount} of {group.variantCount} versions
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
