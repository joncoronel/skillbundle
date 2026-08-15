"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConvex, useConvexAuth } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  CheckmarkBadge01Icon,
  GithubIcon,
  SquareLock02Icon,
} from "@hugeicons/core-free-icons";
import {
  EXAMPLE_REPO_SLUG,
  EXAMPLE_REPO_URL,
  extractRepoSlug,
  matchesDemoRepo,
  isRepoMatchAllowed,
  PRO_REQUIRED,
} from "@/lib/repo-match";
import { signInUrl } from "@/components/auth/shared";
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
type GroupedRecommendation = AnalyzeRepoResult["recommendations"][number];

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
  const {
    limits,
    isLoading: planLoading,
    isAuthLoading,
    isPlanError,
  } = useUserPlan();

  // Result narrowing — local state, not URL state: it scopes one analysis
  // view, resets naturally with the component, and repo links shared without
  // it still show the full picture.
  const [officialOnly, setOfficialOnly] = useState(false);
  const [resultSort, setResultSort] = useState<"match" | "installs">("match");

  const trimmedUrl = repoUrl.trim();
  const parsed = extractRepoSlug(trimmedUrl);

  // Parseability is orthogonal to the plan gate: a submitted value the parser
  // can't read at all (only reachable via a hand-edited or stale pre-parser
  // shared link — the composer validates on submit) is an invalid-URL error for
  // everyone, handled below before any gating. Checking it here keeps the plan
  // logic operating only on real repos, so there's no "unparseable → treat as
  // canAutoDetect" fallback to reason about.
  const invalidUrl = !!trimmedUrl && !parsed;

  // Repo match is Pro-only, but the demo repo (shadcn-ui/ui) runs free for
  // everyone. `allowed` runs the SAME predicate the server throws through, so
  // the client's gate can't drift from the authoritative one (and phase-2's
  // quota lands in one place).
  const isExample = parsed ? matchesDemoRepo(parsed.owner, parsed.repo) : false;
  const canAutoDetect = limits?.canAutoDetect ?? false;
  const allowed = parsed
    ? isRepoMatchAllowed({ canAutoDetect }, parsed.owner, parsed.repo)
    : false;

  // "This user is free" — the plan has resolved (not loading, and not errored:
  // an error is "unknown", not "free", so a Pro user whose plan query blipped
  // isn't wrongly gated) and doesn't grant auto-detect. Feeds the empty-state
  // hint and the demo footer, so they can't disagree with the paywall.
  const planResolvedFree = !planLoading && !isPlanError && !canAutoDetect;

  // The Pro mirror: resolved AND allowed. Gates the repo picker in the empty
  // state, so it can never flash at a free user mid plan-load.
  const planResolvedPro = !planLoading && !isPlanError && canAutoDetect;

  // Definitively locked: a real (parseable) repo this user can't run, plan
  // resolved. The paywall shows with no server round-trip.
  const knownLocked = !!parsed && !allowed && !planLoading && !isPlanError;

  // Fire as soon as we CAN, not once the plan is known. The demo fires
  // immediately; anything else fires the moment auth is ready (so the JWT is
  // attached) unless we already know the user is locked — so a Pro user's cold
  // deep-link analysis runs in parallel with plan resolution, not serially
  // behind it. The server is the authoritative gate (it throws PRO_REQUIRED),
  // so firing before the client plan resolves is safe. Never fires for an
  // unparseable input.
  const canFetch = !!parsed && (isExample || (!isAuthLoading && !knownLocked));

  const { data, isPending, error } = useQuery<AnalyzeRepoResult>({
    queryKey: ["repo", "analyze", trimmedUrl],
    queryFn: () =>
      convex.action(api.recommendations.analyzeRepo, {
        repoUrl: trimmedUrl,
      }),
    enabled: canFetch,
    staleTime: 10 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
  });

  const tryExample = () => setParams({ repoUrl: EXAMPLE_REPO_URL });

  // The plan rejection is a thrown ConvexError, so it lands here as the query
  // error — never cached as data, so it can't pin a paying user to the paywall.
  // Map its code to the paywall; every other error is the generic failure card.
  const proRequired =
    error instanceof ConvexError &&
    (error.data as { code?: string } | undefined)?.code === PRO_REQUIRED;

  // Paywall when the client already knows the user is locked, OR when the
  // server rejected (the authoritative backstop — e.g. a plan blip the client
  // read optimistically as Pro).
  const isPaywall = knownLocked || proRequired;

  // "Analyzing…" is claimed ONLY for a real, allowed analysis in flight. A
  // locked user's query can fire optimistically before the plan resolves, but
  // we never tell them we're analyzing a repo we're about to gate — they get a
  // neutral skeleton, then the paywall.
  const analyzing = isPending && canFetch && (isExample || canAutoDetect);

  // Skeleton for a real (parseable) non-demo repo whenever a fetch is in flight
  // OR its gate is still unknown — the plan resolving, or (when the plan query
  // errored) an optimistic fetch running with no resolved plan. Without the
  // in-flight arm, the plan-error case would flash the empty state, then pop
  // results with no skeleton. An unparseable input is known synchronously, so
  // it skips the skeleton and goes straight to the error card below.
  const loading =
    analyzing ||
    (!!parsed &&
      !isExample &&
      !isPaywall &&
      (planLoading || (isPending && canFetch)));

  // A pro_required rejection routes to the paywall, so it must NOT surface as
  // the generic error card. An unparseable input is the same invalid-URL error
  // the server would return — shown client-side (no round-trip) so a free user
  // and a Pro user get the same truthful message. Returned data errors (server
  // "Invalid GitHub URL", fetch failure) still surface here too.
  const actionError = proRequired
    ? null
    : invalidUrl
      ? "Invalid GitHub URL"
      : error
        ? error.message ||
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
    // Only CLAIM "Analyzing…" when we're actually analyzing. During the plan-
    // resolution wait, telling a soon-to-be-paywalled user we're analyzing
    // their repo would be a promise we're about to retract. The line's space is
    // still reserved (it mirrors the results' "Detected in" line), so the rows
    // don't shift when the text fills in or when results land — it just stays
    // empty until there's something true to say. aria-busy conveys "working."
    //
    // When the claim does become true (plan resolves → Pro/demo fetch begins),
    // the text fades in via @starting-style so its arrival reads as a state
    // change, not a flicker. Kept conditionally rendered (not opacity-toggled)
    // so the role=status live region only announces it once it's real, and a
    // free user's assistive tech never hears a claim they won't get.
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
                "flex items-center gap-3 border bg-card px-4 py-3 dark:border-border/50",
                i === 0 ? "rounded-t-2xl" : "border-t-0",
                i === rowCount - 1 ? "rounded-b-2xl" : "",
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

  // Pre-analysis: no successful result to show. Two states share this slot —
  // the teaching empty state and (for a locked user's own repo) the paywall.
  // Crossfade between them so clicking Analyze resolves the gate as a
  // considered response, not a hard swap. `isPaywall` takes precedence over any
  // in-flight or errored query so a rejection never falls into an empty result.
  if (!data || isPaywall) {
    return (
      <Crossfade active={isPaywall}>
        <RepoMatchEmptyState
          onTryExample={tryExample}
          showUpgradeHint={planResolvedFree}
          showPicker={planResolvedPro}
        />
        <RepoMatchPaywall onTryExample={tryExample} />
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
          is looking at the example — gated on the SAME planResolvedFree as the
          empty-state hint (not a lone !canAutoDetect) so it can't flash at a Pro
          user mid plan-load, and never shows for a non-demo repo. */}
      {planResolvedFree && isExample && (
        <p className="mt-4 text-xs text-muted-foreground">
          This is the {EXAMPLE_REPO_SLUG} example.{" "}
          <Link href="/pricing" className="underline hover:text-foreground">
            Upgrade to Pro
          </Link>{" "}
          to match your own repos.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pre-analysis variants — the two states the Crossfade swaps between
// ---------------------------------------------------------------------------

/**
 * The teaching empty state: what Analyze does, plus a zero-typing way to see it
 * on the free demo. For locked users it also names the Pro boundary up front,
 * so hitting the paywall later reads as expected, not a bait-and-switch.
 */
function RepoMatchEmptyState({
  onTryExample,
  showUpgradeHint,
  showPicker,
}: {
  onTryExample: () => void;
  showUpgradeHint: boolean;
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
      {showUpgradeHint && (
        <p className="mt-4 text-xs text-muted-foreground">
          Matching your own repo is a{" "}
          <Link href="/pricing" className="underline hover:text-foreground">
            Pro
          </Link>{" "}
          feature.
        </p>
      )}
    </div>
  );
}

/**
 * The gate a free / signed-out user hits when they analyze their own repo.
 * Renders inline in the results region (no modal — the register prefers
 * progressive over interruptive), and stays sign-in aware: a signed-out user is
 * routed to sign in first (Pro needs an account), a signed-in free user goes
 * straight to pricing. The demo stays one click away so the wall never dead-ends.
 */
function RepoMatchPaywall({ onTryExample }: { onTryExample: () => void }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  // While auth resolves, assume signed-in so a returning user never flashes the
  // "sign in" CTA. Pro users never reach this branch, so the fallback is safe.
  const showSignIn = !isLoading && !isAuthenticated;

  return (
    <div className="mt-4 rounded-2xl border bg-card px-6 py-10 text-center">
      <HugeiconsIcon
        icon={SquareLock02Icon}
        strokeWidth={1.5}
        className="mx-auto size-6 text-muted-foreground/60"
      />
      <p className="mt-3 text-sm font-medium">
        Matching your own repo is a Pro feature
      </p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        Analyze any public GitHub repo and get skills matched to its stack. Try
        it free on {EXAMPLE_REPO_SLUG}, or upgrade to match your own repos.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {showSignIn ? (
          <Button
            nativeButton={false}
            variant="primary"
            size="sm"
            render={<Link href={signInUrl("/pricing")} />}
          >
            Sign in to upgrade
          </Button>
        ) : (
          <Button
            nativeButton={false}
            variant="primary"
            size="sm"
            render={<Link href="/pricing" />}
          >
            Upgrade to Pro
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
        // Selection-border continuity at group boundaries:
        //
        // 1) Color the group's bottom border when followed by a checked
        //    singleton. The singleton has border-t-0 in the outer-list merge,
        //    so its visual top edge IS the group's bottom edge.
        "[&:has(+_label_[data-checked])]:border-b-primary/30",
        // 2) Color the group's left + right borders when ANY variant inside
        //    it is checked. Variants have border-x-0 (no horizontal borders
        //    of their own), so the only paintable L/R edges in this region
        //    belong to the outer Collapsible. The orange tints the whole
        //    group's sides, signaling "a variant inside this group is
        //    selected" — without introducing any new borders.
        "has-[label[data-checked]]:border-x-primary/30 dark:has-[label[data-checked]]:border-x-primary/30",
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
