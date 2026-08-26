"use client";

import { Activity } from "react";
import type { FunctionReturnType } from "convex/server";
import {
  CatalogFacetsProvider,
  ExplorerStateProvider,
  useExplorerState,
} from "@/components/explorer-state";
import {
  catalogSearchQueryKey,
  useCatalogSearchStatus,
} from "@/hooks/use-catalog-search";
import { useDebouncedQueryValue } from "@/hooks/use-debounced-query-value";
import { PopularList } from "@/components/default-skills-list";
import { SkillComposer } from "@/components/skill-composer";
import { ActiveCatalogResults } from "@/components/catalog-results";
import { LeaderboardSheet } from "@/components/leaderboard-sheet";
import { RepoAnalysisResults } from "@/components/repo-url-input";
import {
  SkillDetailSheet,
  SkillDetailHandleProvider,
  createSkillDetailHandle,
} from "@/components/skill-detail-sheet";
import type { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

interface SkillExplorerProps {
  initialPopularSkills: FunctionReturnType<typeof api.skills.listPopularSkills>;
}

const skillDetailHandle = createSkillDetailHandle();

/**
 * Live wrapper: mounts the nuqs-backed explorer state provider around the
 * view. Reading search params makes this subtree dynamic under Cache
 * Components, so app/(main)/page.tsx wraps it in Suspense with a fallback
 * that renders the same view under ExplorerStaticProvider (the no-params
 * entry state) — see app/(main)/home-content.tsx.
 */
export function SkillExplorer(props: SkillExplorerProps) {
  return (
    <ExplorerStateProvider>
      <SkillExplorerView {...props} />
    </ExplorerStateProvider>
  );
}

/**
 * The home page's discovery surface — ONE stable layout (no view transitions,
 * no hero-collapse, no relocating search box). The hero, the search composer,
 * and its chin hold fixed positions; only the list region below changes.
 * Typing and activating a filter are therefore the same gesture — both just
 * swap what's in the list — which is what makes the two feel consistent (an
 * earlier design morphed the whole page when you searched, which was jarring
 * when your first action was a filter, not typing).
 *
 * - **Idle:** the SSR'd + infinite-scroll Popular catalog renders.
 * - **Query / filter / non-default sort active:** the list swaps to
 *   Typesense-backed results in the same spot. The Popular list stays mounted
 *   (hidden via <Activity>) so clearing the search restores scroll depth.
 * - **Repo mode:** the same region shows repo match results.
 *
 * URL state comes from the explorer context (provided above, or statically by
 * the Suspense fallback). Search status — the input spinner, the
 * Popular→results handoff, facet counts — is DERIVED here from the shared
 * React Query cache (useCatalogSearchStatus): this component owns the
 * debounced effective query, ActiveCatalogResults fetches under the same key,
 * and nothing is reported back up through effects. Anything that reads
 * Date.now() during render (the Typesense infinite query) still mounts only
 * when a search is active — never in the prerendered idle state.
 */
export function SkillExplorerView({
  initialPopularSkills,
}: SkillExplorerProps) {
  const {
    textQuery,
    trimmedQuery,
    hasQuery,
    isRepo,
    anyFilter,
    hasNarrowing,
    searchActive,
    effectiveSort,
    filters,
    searchDescriptions,
    view,
    setParams,
  } = useExplorerState();

  // The effective (debounced / cache-bypassed) query — the ONE value
  // ActiveCatalogResults fetches with, so the status derivation below reads
  // the same cache entries the results render from.
  const effectiveQuery = useDebouncedQueryValue(textQuery, (trimmed) =>
    catalogSearchQueryKey(trimmed, effectiveSort, filters, searchDescriptions),
  );

  // Mount the results view only once there's something REAL to fetch: the
  // debounced query has caught up, or a filter narrows the browse ("" + a
  // filter is a legitimate filtered-browse). Without this gate, the first
  // keystroke of a fresh search — searchActive already true, effectiveQuery
  // still "" for the debounce window — would fire a match-all browse the old
  // per-mount debounce never issued, and its (cached) full-catalog rows would
  // flash as settled results before the typed query's rows land.
  const resultsActive = searchActive && (effectiveQuery !== "" || anyFilter);

  // Derived search status — no report-up callbacks, no effect mirrors:
  // - pending: work outstanding for what's typed (debounce/fetch); cached
  //   retypes are never pending, so the spinner can't lie.
  // - settled: results have something to render; until then the Popular list
  //   stays up (dimmed) as filler, so a cold search never flashes empty.
  // - facets: live counts for the filter controls, held across refinements.
  // `active` is searchActive (not resultsActive): the spinner must run through
  // the first debounce window, before the results view mounts. settled can't
  // false-positive there — the gated "" browse entry is never fetched.
  const { pending, settled, facets } = useCatalogSearchStatus({
    trimmedQuery,
    effectiveQuery,
    sort: effectiveSort,
    filters,
    searchDescriptions,
    active: searchActive,
  });
  const showInputSpinner = hasQuery && pending;

  return (
    // Providers for what the layout below shares: rows open the skill detail
    // sheet, filter controls read the current facet counts — neither is
    // couriered through the components in between.
    <SkillDetailHandleProvider handle={skillDetailHandle}>
      <CatalogFacetsProvider facets={facets}>
        {/* Discovery column: hero + search composer + list region. */}
        <div className="relative pb-20 sm:min-h-[calc(100dvh-4.5rem)] sm:px-8 lg:px-10">
          {/* Hero — constant, scrolls away (never collapses). */}
          <section className="pt-10 pb-6 sm:pt-12">
            <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">
              Pick skills.{" "}
              <span className="text-primary">Ship one install command.</span>
            </h1>
            <p className="mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
              Search and compare skills for Cursor, Claude Code, and other
              coding agents. Bundle the ones you want and share the whole set
              with a link.
            </p>
          </section>

          <SkillComposer showInputSpinner={showInputSpinner} />

          {isRepo ? (
            /* Repo mode's region: match results (or the paste-a-repo empty
             state). starting: fades it in on the mode morph — it only mounts
             on entry, so the static shell never sees the fade. */
            <div className="pt-4 transition-opacity duration-240 ease-out-cubic motion-reduce:transition-none starting:opacity-0">
              <RepoAnalysisResults />
            </div>
          ) : (
            /* List region — the ONLY thing that changes on interaction. */
            <div className="pt-4">
              {/* Popular list stays mounted (preserves scroll + pagination).
                While a search is settling it dims as filler; once results are
                ready, <Activity mode="hidden"> takes it out of the document
                AND out of React's urgent render path — with a bare CSS
                `hidden`, the hidden subtree still re-rendered at full
                priority on every keystroke. */}
              <Activity mode={searchActive && settled ? "hidden" : "visible"}>
                <div
                  className={cn(
                    "transition-opacity duration-200 ease-out-cubic motion-reduce:transition-none",
                    searchActive && !settled && "opacity-55",
                  )}
                >
                  <CatalogNote>
                    The full catalog, sorted by all-time installs from{" "}
                    <SkillsShLink />
                  </CatalogNote>
                  <PopularList initialPage={initialPopularSkills} />
                </div>
              </Activity>
              {resultsActive && (
                <ActiveCatalogResults
                  query={effectiveQuery}
                  stale={trimmedQuery !== effectiveQuery}
                  sort={effectiveSort}
                  filters={filters}
                  searchDescriptions={searchDescriptions}
                  hasNarrowing={hasNarrowing}
                />
              )}
            </div>
          )}
        </div>

        {/* BundleBar is mounted by the (main) layout (GlobalBundleBar) so its
          state persists across navigation to /compare. */}
        <SkillDetailSheet handle={skillDetailHandle} />
        {/* Fetches its own rows, only while open. See `useLeaderboard`. */}
        <LeaderboardSheet
          view={view}
          onViewChange={(v) => setParams({ view: v })}
        />
      </CatalogFacetsProvider>
    </SkillDetailHandleProvider>
  );
}

/** Thin attribution/context line above a lens's list. */
function CatalogNote({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-xs text-muted-foreground">{children}</p>;
}

function SkillsShLink() {
  return (
    <a
      href="https://skills.sh"
      target="_blank"
      rel="noopener noreferrer"
      className="underline transition-colors hover:text-foreground"
    >
      skills.sh
    </a>
  );
}
