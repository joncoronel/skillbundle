"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConvex, useConvexAuth } from "convex/react";
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
  isDemoRepoInput,
} from "@/lib/repo-match";
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
  const { limits, isLoading: planLoading } = useUserPlan();

  // Result narrowing — local state, not URL state: it scopes one analysis
  // view, resets naturally with the component, and repo links shared without
  // it still show the full picture.
  const [officialOnly, setOfficialOnly] = useState(false);
  const [resultSort, setResultSort] = useState<"match" | "installs">("match");

  const trimmedUrl = repoUrl.trim();

  // Repo match is Pro-only, but the demo repo (shadcn-ui/ui) runs free for
  // everyone. Locked users who ask for their own repo get the paywall instead.
  const isExample = isDemoRepoInput(trimmedUrl);
  const canAutoDetect = limits?.canAutoDetect ?? false;

  // Fetch only when it can succeed: the demo always, any other repo once the
  // plan has RESOLVED and allows it. Gating non-demo fetches on `!planLoading`
  // also guarantees the Convex JWT is attached (the plan query itself needs
  // auth), so analyzeRepo never runs unauthenticated during the load window and
  // caches a bogus "requires Pro" rejection.
  const canFetch = isExample || (!planLoading && canAutoDetect);

  const { data, isPending, error } = useQuery<AnalyzeRepoResult>({
    queryKey: ["repo", "analyze", trimmedUrl],
    queryFn: () =>
      convex.action(api.recommendations.analyzeRepo, {
        repoUrl: trimmedUrl,
      }),
    enabled: !!trimmedUrl && canFetch,
    staleTime: 10 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
  });

  const tryExample = () => setParams({ repoUrl: EXAMPLE_REPO_URL });

  // A plan rejection — from the server now, or a stale/raced cache entry —
  // always resolves to the paywall, never the raw error card. The client gate
  // is UX-only; this typed code is what makes that true even for cached results.
  const proRequired = data?.errorCode === "pro_required";

  // Two distinct waits share the skeleton. `analyzing` is the real one — a repo
  // we're allowed to fetch, with the request in flight. The other is the plan
  // still resolving for a non-demo repo: we show the skeleton then too so the
  // gate doesn't flash (paywall at a Pro user, or the empty state) for a frame,
  // but it is NOT analysis, so it must not claim to be (see the status line).
  const analyzing = !!trimmedUrl && canFetch && isPending;
  const loading = analyzing || (!!trimmedUrl && planLoading && !isExample);

  // A plan rejection is routed to the paywall below, so it must NOT surface as
  // the generic error card (which would otherwise shadow the paywall).
  const actionError = proRequired
    ? null
    : error
      ? error.message || "Something went wrong analyzing this repository. Please try again."
      : data?.error ?? null;

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
        <p
          role="status"
          className="mb-4 min-h-4 text-xs text-muted-foreground"
        >
          {analyzing && (
            <span className="starting:opacity-0 transition-opacity duration-240 ease-out-cubic motion-reduce:transition-none">
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
                  className={cn("h-5 rounded-sm", i % 2 === 0 ? "w-32" : "w-24")}
                />
                <Skeleton
                  className={cn("h-4 rounded-sm", i % 3 === 0 ? "w-24" : "w-16")}
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
          Double-check the URL — public GitHub repos only, like
          github.com/vercel/next.js.
        </p>
      </div>
    );
  }

  const result = data;

  // Paywall precedence: a locked user's own repo, or any plan rejection that
  // slipped through as data (a stale/raced cache entry). Checked before the
  // results render so a `pro_required` result can never fall through into an
  // empty results view.
  const isPaywall =
    !!trimmedUrl && (proRequired || (!isExample && !canAutoDetect));

  // Pre-analysis: no successful result to show. Two states share this slot —
  // the teaching empty state and (for a locked user's own repo) the paywall.
  // Crossfade between them so clicking Analyze resolves the gate as a
  // considered response, not a hard swap.
  if (!result || isPaywall) {
    return (
      <Crossfade active={isPaywall}>
        <RepoMatchEmptyState
          onTryExample={tryExample}
          showUpgradeHint={!planLoading && !canAutoDetect}
        />
        <RepoMatchPaywall onTryExample={tryExample} />
      </Crossfade>
    );
  }

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

      {/* The demo is the taste; this is the ask. Only when a locked user is
          looking at the free example — Pro users (canAutoDetect) and any
          non-demo repo never see it. */}
      {!canAutoDetect && isExample && (
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
}: {
  onTryExample: () => void;
  showUpgradeHint: boolean;
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
      <Button
        variant="outline"
        size="sm"
        className="mt-4"
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
function RepoMatchPaywall({
  onTryExample,
}: {
  onTryExample: () => void;
}) {
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
            render={
              <Link
                href={`/sign-in?redirect_url=${encodeURIComponent("/pricing")}`}
              />
            }
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
        "text-card-foreground flex flex-col bg-card rounded-2xl border dark:border-border/50",
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
          "py-3 px-4 w-full",
        )}
      >
        <div className="flex items-center gap-3 w-full">
          <span className="min-w-0 truncate text-sm font-semibold text-left">
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
