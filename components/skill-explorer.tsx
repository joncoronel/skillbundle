"use client";

import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryState } from "nuqs";
import type { FunctionReturnType } from "convex/server";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Search01Icon,
  Cancel01Icon,
  GithubIcon,
  FlashIcon,
  FilterHorizontalIcon,
} from "@hugeicons/core-free-icons";
import {
  modeParser,
  searchQueryParser,
  repoUrlParser,
  catalogSortParser,
  officialFilterParser,
  auditFilterParser,
  minInstallsParser,
  searchDescriptionsParser,
  brokenFilterParser,
  leaderboardTabParser,
  type ModeValue,
  type CatalogSortValue,
  type AuditFilterValue,
  type LeaderboardTabValue,
} from "@/lib/search-params";
import type { FacetCount, SkillFilters } from "@/lib/search/typesense";
import { Input } from "@/components/ui/cubby-ui/input";
import { Kbd } from "@/components/ui/cubby-ui/kbd";
import { Button } from "@/components/ui/cubby-ui/button";
import { DotMatrixRipple } from "@/components/ui/dot-matrix-ripple";
import {
  PopularList,
  SkillRowGrid,
  EmptyState,
  rowToSkill,
} from "@/components/default-skills-list";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/cubby-ui/tabs";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
} from "@/components/ui/cubby-ui/sheet";
import { CatalogControls } from "@/components/catalog-controls";
import { ActiveCatalogResults } from "@/components/catalog-results";
import { RepoAnalysisResults } from "@/components/repo-url-input";
import {
  SkillDetailSheet,
  createSkillDetailHandle,
} from "@/components/skill-detail-sheet";
import type { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

interface SkillExplorerProps {
  canAutoDetect: boolean;
  initialPopularSkills: FunctionReturnType<typeof api.skills.listPopularSkills>;
  initialTrending: FunctionReturnType<typeof api.leaderboards.listTrending>;
  initialHot: FunctionReturnType<typeof api.leaderboards.listHot>;
}

const skillDetailHandle = createSkillDetailHandle();

/**
 * nuqs-backed wrapper around the presentational SkillExplorerView. Mode, sort,
 * and filter writes go through React's startTransition (via nuqs withOptions)
 * so the list re-render they trigger is non-urgent — the controls stay
 * responsive while the (potentially large) results list updates behind them.
 *
 * Reads search params via nuqs' Next adapter (useSearchParams), which makes
 * this subtree dynamic under Cache Components — so app/(main)/page.tsx wraps it
 * in Suspense with a fallback that renders the default entry state (the same
 * SkillExplorerView fed ENTRY_STATE_DEFAULTS).
 */
export function SkillExplorer({
  canAutoDetect,
  initialPopularSkills,
  initialTrending,
  initialHot,
}: SkillExplorerProps) {
  const [mode, setMode] = useQueryState(
    "mode",
    modeParser.withOptions({ startTransition }),
  );
  const [textQuery, setTextQuery] = useQueryState("q", searchQueryParser);
  const [repoUrl, setRepoUrl] = useQueryState("repo", repoUrlParser);
  const [sortParam, setSortParam] = useQueryState(
    "sort",
    catalogSortParser.withOptions({ startTransition }),
  );
  const [official, setOfficial] = useQueryState(
    "official",
    officialFilterParser.withOptions({ startTransition }),
  );
  const [audit, setAudit] = useQueryState(
    "audit",
    auditFilterParser.withOptions({ startTransition }),
  );
  const [minInstalls, setMinInstalls] = useQueryState(
    "min",
    minInstallsParser.withOptions({ startTransition }),
  );
  const [searchDescriptions, setSearchDescriptions] = useQueryState(
    "desc",
    searchDescriptionsParser.withOptions({ startTransition }),
  );
  const [broken, setBroken] = useQueryState(
    "broken",
    brokenFilterParser.withOptions({ startTransition }),
  );
  // Which leaderboard view the entry-state catalog shows. URL-backed so the
  // active tab is shareable and survives back/forward ("popular" stays
  // unrepresented in the URL — only trending/hot emit `?tab=`).
  const [tab, setTab] = useQueryState("tab", leaderboardTabParser);

  return (
    <SkillExplorerView
      tab={tab}
      onTabChange={setTab}
      mode={mode}
      onModeChange={setMode}
      textQuery={textQuery}
      onTextQueryChange={setTextQuery}
      repoUrl={repoUrl}
      onRepoUrlChange={setRepoUrl}
      sortParam={sortParam}
      onSortParamChange={setSortParam}
      official={official}
      onOfficialChange={setOfficial}
      audit={audit}
      onAuditChange={setAudit}
      minInstalls={minInstalls}
      onMinInstallsChange={setMinInstalls}
      searchDescriptions={searchDescriptions}
      onSearchDescriptionsChange={setSearchDescriptions}
      broken={broken}
      onBrokenChange={setBroken}
      canAutoDetect={canAutoDetect}
      initialPopularSkills={initialPopularSkills}
      initialTrending={initialTrending}
      initialHot={initialHot}
    />
  );
}

interface SkillExplorerViewProps extends SkillExplorerProps {
  tab: LeaderboardTabValue;
  onTabChange: (tab: LeaderboardTabValue) => void;
  mode: ModeValue;
  onModeChange: (mode: ModeValue) => void;
  textQuery: string;
  onTextQueryChange: (q: string) => void;
  repoUrl: string;
  onRepoUrlChange: (url: string) => void;
  sortParam: CatalogSortValue | null;
  onSortParamChange: (sort: CatalogSortValue | null) => void;
  official: boolean;
  onOfficialChange: (v: boolean) => void;
  audit: AuditFilterValue | null;
  onAuditChange: (v: AuditFilterValue | null) => void;
  minInstalls: number | null;
  onMinInstallsChange: (v: number | null) => void;
  searchDescriptions: boolean;
  onSearchDescriptionsChange: (v: boolean) => void;
  broken: boolean;
  onBrokenChange: (v: boolean) => void;
}

const noop = () => {};

/**
 * The default no-params entry state as props — parser defaults (keep in sync
 * with lib/search-params.ts) + noop setters. The page's Suspense fallback
 * (app/(main)/home-content.tsx) spreads this into SkillExplorerView so the
 * static shell renders the exact idle state without reading search params,
 * while the live SkillExplorer supplies the real nuqs values + setters.
 */
export const ENTRY_STATE_DEFAULTS: Omit<
  SkillExplorerViewProps,
  "canAutoDetect" | "initialPopularSkills" | "initialTrending" | "initialHot"
> = {
  tab: "popular",
  onTabChange: noop,
  mode: "text",
  onModeChange: noop,
  textQuery: "",
  onTextQueryChange: noop,
  repoUrl: "",
  onRepoUrlChange: noop,
  sortParam: null,
  onSortParamChange: noop,
  official: false,
  onOfficialChange: noop,
  audit: null,
  onAuditChange: noop,
  minInstalls: null,
  onMinInstallsChange: noop,
  searchDescriptions: false,
  onSearchDescriptionsChange: noop,
  broken: false,
  onBrokenChange: noop,
};

/**
 * The home page's discovery surface — ONE stable layout (no view transitions,
 * no hero-collapse, no relocating search box). The hero, the search input, and
 * the sort/filter/tabs bar hold fixed positions; only the list region below
 * changes. Typing and activating a filter are therefore the same gesture —
 * both just swap what's in the list — which is what makes the two feel
 * consistent (an earlier design morphed the whole page when you searched,
 * which was jarring when your first action was a filter, not typing).
 *
 * - **Idle:** the Popular/Trending/Hot tab you're on renders its list (Popular
 *   is the SSR'd + infinite-scroll Convex catalog; Trending/Hot are the cached
 *   leaderboard snapshots).
 * - **Query / filter / non-default sort active:** the Popular tab's list swaps
 *   to Typesense-backed results in the same spot. The Popular list stays
 *   mounted (hidden) so clearing the search restores scroll depth.
 *
 * The search + controls bar is `sticky` so it stays reachable through a long
 * list — sticky-on-scroll, tied to scrolling (which the user controls), never
 * relocating on a click.
 *
 * Presentational (URL state comes in via props). The split from the nuqs
 * wrapper (SkillExplorer) keeps this component free of the URL read, so the
 * page's Suspense fallback can render the idle state statically from
 * ENTRY_STATE_DEFAULTS (no useSearchParams). Anything that reads Date.now()
 * during render (the Typesense infinite query in ActiveCatalogResults) still
 * mounts only when a search is active — never in the prerendered idle state.
 */
export function SkillExplorerView({
  tab,
  onTabChange,
  mode,
  onModeChange,
  textQuery,
  onTextQueryChange,
  repoUrl,
  onRepoUrlChange,
  sortParam,
  onSortParamChange,
  official,
  onOfficialChange,
  audit,
  onAuditChange,
  minInstalls,
  onMinInstallsChange,
  searchDescriptions,
  onSearchDescriptionsChange,
  broken,
  onBrokenChange,
  canAutoDetect,
  initialPopularSkills,
  initialTrending,
  initialHot,
}: SkillExplorerViewProps) {
  const trimmed = textQuery.trim();
  const deferredTrimmed = useDeferredValue(trimmed);
  const hasQuery = trimmed.length > 0;

  // In-input search spinner. `searchQueryPending` is reported up from
  // ActiveCatalogResults (debounce + Typesense fetch); the `trimmed !==
  // deferredTrimmed` term covers the gap between a keystroke and that
  // component mounting, so the spinner appears on the very first character.
  // Gated on a non-empty query so a filter-only load doesn't spin an empty box.
  const [searchQueryPending, setSearchQueryPending] = useState(false);
  const showInputSpinner =
    mode !== "repo" &&
    trimmed.length > 0 &&
    (searchQueryPending || trimmed !== deferredTrimmed);

  // Live facet counts for the filter controls. Reported up from
  // ActiveCatalogResults (which owns the Typesense query); empty when no search
  // is active, so counts only show on the result set they describe.
  const [facets, setFacets] = useState<Record<string, FacetCount[]>>({});

  // Whether the active search has results to show yet. Until it does (the cold
  // first fetch), the Popular list stays up — dimmed — as filler, so there's
  // no empty flash; it hands off to the results the moment they land.
  const [searchSettled, setSearchSettled] = useState(false);

  // Trending/Hot tab rows, mapped once from the server-cached snapshots (the
  // leaderboard crons keep those fresh; there's no client subscription).
  const trendingSkills = useMemo(
    () => (initialTrending?.page ?? []).map(rowToSkill),
    [initialTrending],
  );
  const hotSkills = useMemo(
    () => (initialHot ?? []).map(rowToSkill),
    [initialHot],
  );

  const anyFilter =
    official ||
    audit !== null ||
    minInstalls !== null ||
    broken ||
    sortParam !== null;
  const isRepo = mode === "repo";
  const searchActive = !isRepo && (hasQuery || anyFilter);

  // When a search/filter is active you're implicitly in the catalog, so the
  // Popular tab is the one that's "on" — Trending/Hot are fixed lenses that
  // don't compose with a query. This is display-only; the URL keeps `tab` so
  // clearing the search returns you to whichever lens you were browsing.
  const effectiveTab: LeaderboardTabValue = searchActive ? "popular" : tab;

  const effectiveSort: CatalogSortValue =
    sortParam ?? (hasQuery ? "relevance" : "installs");
  const filters: SkillFilters = {
    officialOnly: official || undefined,
    audit: audit ?? undefined,
    minInstalls: minInstalls ?? undefined,
    // Always hide skills.sh-flagged forks/copies (parity with the cached
    // Popular query's `!isDuplicate`). No user toggle: the flag is unset across
    // the whole catalog today, so a control would do nothing — see
    // docs/search-overhaul.md. Kept here so it auto-applies if it ever populates.
    hideForks: true,
    excludeBroken: broken || undefined,
  };

  // One-tap reset of every filter (sort stays — it's a view preference, not a
  // narrowing). Setting each param to its parser default removes it from the
  // URL, which also drops the page back to the entry state.
  function handleClearFilters() {
    onOfficialChange(false);
    onAuditChange(null);
    onMinInstallsChange(null);
    onBrokenChange(false);
  }

  // Choosing the sort the UI would auto-resolve to anyway clears the param, so
  // the URL only carries explicit deviations and "sort: installs with nothing
  // else" stays the entry state instead of needlessly activating Typesense.
  function handleSortChange(next: CatalogSortValue) {
    const autoDefault: CatalogSortValue = hasQuery ? "relevance" : "installs";
    onSortParamChange(next === autoDefault ? null : next);
  }

  // Switching to Trending/Hot leaves any active search behind — they're clean
  // browse lenses that ignore query/sort/filters, so clearing lets the lens
  // actually show (otherwise `searchActive` would keep pinning Popular).
  function handleTabChange(next: LeaderboardTabValue) {
    if (next !== "popular" && searchActive) {
      onTextQueryChange("");
      onSortParamChange(null);
      handleClearFilters();
    }
    onTabChange(next);
  }

  // Local input state for the repo field — only pushed to the URL on submit.
  const [repoInput, setRepoInput] = useState(repoUrl);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: focus on /
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.key === "/" &&
        !e.ctrlKey &&
        !e.metaKey &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function handleRepoSubmit() {
    const submitted = repoInput.trim();
    if (!submitted) return;
    onRepoUrlChange(submitted);
  }

  const inputValue = isRepo ? repoInput : textQuery;
  const placeholder = isRepo
    ? "https://github.com/owner/repo"
    : "Search skills…";

  const controls = (
    facets?: Record<string, FacetCount[]>,
    layout: "bar" | "sheet" = "bar",
  ) => (
    <CatalogControls
      sort={effectiveSort}
      hasQuery={hasQuery}
      onSortChange={handleSortChange}
      official={official}
      onOfficialChange={onOfficialChange}
      audit={audit}
      onAuditChange={onAuditChange}
      minInstalls={minInstalls}
      onMinInstallsChange={onMinInstallsChange}
      searchDescriptions={searchDescriptions}
      onSearchDescriptionsChange={onSearchDescriptionsChange}
      broken={broken}
      onBrokenChange={onBrokenChange}
      onClearFilters={handleClearFilters}
      facets={facets}
      layout={layout}
    />
  );

  const filterCount =
    (official ? 1 : 0) +
    (audit ? 1 : 0) +
    (minInstalls !== null ? 1 : 0) +
    (broken ? 1 : 0);

  // The search input — shared by text + repo mode. `inputClassName` is an
  // optional restyle hook; both modes use the default bordered input.
  const searchField = (inputClassName?: string) => (
    <div className="relative flex-1">
      {showInputSpinner ? (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 flex size-4 items-center justify-center text-muted-foreground pointer-events-none">
          <DotMatrixRipple size="xs" ariaLabel="Searching" />
        </span>
      ) : (
        <HugeiconsIcon
          icon={isRepo ? GithubIcon : Search01Icon}
          strokeWidth={2}
          className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none"
        />
      )}
      <Input
        ref={inputRef}
        placeholder={placeholder}
        value={inputValue}
        onChange={(e) => {
          if (isRepo) {
            setRepoInput(e.target.value);
          } else {
            onTextQueryChange(e.target.value);
          }
        }}
        onKeyDown={(e) => {
          if (isRepo && e.key === "Enter") handleRepoSubmit();
        }}
        className={cn("pl-9 pr-9", inputClassName)}
      />
      {!inputValue && (
        <Kbd
          size="sm"
          variant="ghost"
          className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none max-sm:hidden"
          aria-hidden="true"
        >
          /
        </Kbd>
      )}
      {inputValue && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            if (isRepo) {
              setRepoInput("");
              onRepoUrlChange("");
            } else {
              onTextQueryChange("");
            }
          }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-2 focus-visible:outline-ring/50 focus-visible:outline-offset-2"
        >
          <HugeiconsIcon
            icon={Cancel01Icon}
            strokeWidth={2}
            className="size-4"
          />
        </button>
      )}
    </div>
  );

  return (
    <>
      {/* Framed discovery column. On desktop faint vertical rails flank the
          hero + search + list, and the search's full-bleed border-b meets them
          at a small crosshair — a restrained technical frame that gives the page
          structure. Mobile drops the rails; only the horizontal separator under
          the search remains. */}
      <div className="relative sm:border-x sm:border-border sm:px-8 lg:px-10">
        {/* Hero — constant, scrolls away (never collapses). */}
        <section className="pt-10 pb-6 sm:pt-12">
          <h1 className="font-display text-3xl font-medium tracking-tight text-balance sm:text-4xl">
            Pick skills.{" "}
            <span className="text-primary">Ship one install command.</span>
          </h1>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
            Search and compare skills for Cursor, Claude Code, and other coding
            agents. Bundle the ones you want and share the whole set with a link.
          </p>
        </section>

        {isRepo ? (
          <>
            {/* Search bar — repo mode. Flat sticky toolbar (no card): bordered
                input + primary Analyze + a way back to search, over one full-bleed
                border-b that meets the desktop rails. */}
            <div className="sticky top-14 z-30 -mx-4 border-b border-border bg-background/85 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
              <RailJoints />
              <div className="flex items-center gap-2">
                {searchField()}
                <Button
                  onClick={handleRepoSubmit}
                  disabled={!repoInput.trim() || !canAutoDetect}
                  className="shrink-0 max-sm:px-3"
                  leftSection={
                    <HugeiconsIcon
                      icon={FlashIcon}
                      strokeWidth={2}
                      className="size-3.5"
                    />
                  }
                >
                  Analyze
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-muted-foreground max-sm:px-2"
                  onClick={() => onModeChange("text")}
                  leftSection={
                    <HugeiconsIcon
                      icon={Search01Icon}
                      strokeWidth={2}
                      className="size-3.5"
                    />
                  }
                >
                  <span className="max-sm:sr-only">Search skills</span>
                </Button>
              </div>
            </div>
            <div>
              <RepoAnalysisResults
                repoUrl={repoUrl}
                canAutoDetect={canAutoDetect}
                sheetHandle={skillDetailHandle}
                onTryExample={(url) => {
                  setRepoInput(url);
                  onRepoUrlChange(url);
                }}
              />
            </div>
          </>
        ) : (
          <Tabs
            value={effectiveTab}
            onValueChange={(v) => handleTabChange(v as LeaderboardTabValue)}
          >
            {/* Search bar — text mode. Flat sticky toolbar (no card): bordered
                input + Match repo on top, sort/filter controls + browse tabs
                below, over one full-bleed border-b that meets the desktop rails. */}
            <div className="sticky top-14 z-30 -mx-4 border-b border-border bg-background/85 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
              <RailJoints />
              {/* Search row */}
              <div className="flex items-center gap-2">
                {searchField()}
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-muted-foreground max-sm:px-2"
                  onClick={() => onModeChange("repo")}
                  leftSection={
                    <HugeiconsIcon
                      icon={FlashIcon}
                      strokeWidth={2}
                      className="size-3.5"
                    />
                  }
                >
                  <span className="max-sm:sr-only">Match repo</span>
                </Button>
              </div>

              {/* Controls + browse-lens tabs. Tabs anchored right so they don't
                  shift when controls appear; on mobile the controls collapse to a
                  "Sort & filter" trigger that opens a bottom sheet. */}
              <div className="mt-2.5 flex items-center justify-between gap-x-3 gap-y-2">
                {effectiveTab === "popular" ? (
                  <>
                    {/* Desktop: inline controls */}
                    <div className="hidden min-w-0 sm:flex sm:items-center sm:gap-1.5 sm:flex-wrap">
                      {controls(facets)}
                    </div>
                    {/* Mobile: single trigger → bottom sheet */}
                    <div className="sm:hidden">
                      <Sheet>
                        <SheetTrigger
                          render={
                            <Button
                              variant="outline"
                              size="sm"
                              leftSection={
                                <HugeiconsIcon
                                  icon={FilterHorizontalIcon}
                                  strokeWidth={2}
                                  className="size-3.5"
                                />
                              }
                              rightSection={
                                filterCount > 0 ? (
                                  <span className="flex size-4.5 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground tabular-nums">
                                    {filterCount}
                                  </span>
                                ) : undefined
                              }
                            />
                          }
                        >
                          Sort & filter
                        </SheetTrigger>
                        <SheetContent side="bottom">
                          <SheetHeader>
                            <SheetTitle>Sort &amp; filter</SheetTitle>
                          </SheetHeader>
                          <SheetBody>{controls(facets, "sheet")}</SheetBody>
                        </SheetContent>
                      </Sheet>
                    </div>
                  </>
                ) : (
                  <span />
                )}
                <TabsList variant="capsule" size="small" aria-label="Browse">
                  <TabsTrigger value="popular">Popular</TabsTrigger>
                  <TabsTrigger value="trending">Trending</TabsTrigger>
                  <TabsTrigger value="hot">Hot</TabsTrigger>
                </TabsList>
              </div>
            </div>

            {/* List region — the ONLY thing that changes on interaction. */}
            <div className="pt-4">
              {effectiveTab === "popular" && (
                <>
                  {/* Popular list stays mounted (preserves scroll + pagination).
                      While a search is settling it dims as filler; once results
                      are ready it's hidden and hands off to them. */}
                  <div
                    className={cn(
                      "transition-opacity duration-200 ease-out-cubic motion-reduce:transition-none",
                      searchActive && searchSettled && "hidden",
                      searchActive && !searchSettled && "opacity-55",
                    )}
                  >
                    <CatalogNote>
                      The full catalog, sorted by all-time installs from{" "}
                      <SkillsShLink />
                    </CatalogNote>
                    <PopularList
                      initialPage={initialPopularSkills}
                      sheetHandle={skillDetailHandle}
                    />
                  </div>
                  {searchActive && (
                    <ActiveCatalogResults
                      rawQuery={textQuery}
                      sort={effectiveSort}
                      filters={filters}
                      searchDescriptions={searchDescriptions}
                      anyFilterActive={anyFilter}
                      sheetHandle={skillDetailHandle}
                      onSettledChange={setSearchSettled}
                      onLoadingChange={setSearchQueryPending}
                      onFacetsChange={setFacets}
                    />
                  )}
                </>
              )}

              {effectiveTab === "trending" && (
                <>
                  <CatalogNote>
                    Most installed in the last 24 hours on <SkillsShLink />
                  </CatalogNote>
                  {trendingSkills.length === 0 ? (
                    <EmptyState message="No trending data yet — check back after the next sync." />
                  ) : (
                    <SkillRowGrid
                      skills={trendingSkills}
                      sheetHandle={skillDetailHandle}
                      metric="trending"
                    />
                  )}
                </>
              )}

              {effectiveTab === "hot" && (
                <>
                  <CatalogNote>
                    Most installed in the last hour on <SkillsShLink />
                  </CatalogNote>
                  {hotSkills.length === 0 ? (
                    <EmptyState message="No hot skills right now — check back after the next sync." />
                  ) : (
                    <SkillRowGrid
                      skills={hotSkills}
                      sheetHandle={skillDetailHandle}
                      metric="hot"
                    />
                  )}
                </>
              )}
            </div>
          </Tabs>
        )}
      </div>

      {/* BundleBar is mounted by the (main) layout (GlobalBundleBar) so its
          state persists across navigation to /compare. */}
      <SkillDetailSheet handle={skillDetailHandle} />
    </>
  );
}

/**
 * Small crosshairs where the sticky search bar's border-b crosses the desktop
 * rails — makes the horizontal separator read as *connected* to the frame
 * rather than floating over it. Desktop-only, decorative, and part of the
 * sticky bar so they track its position on scroll. The bar bleeds to the rails
 * (`-mx`), so its bottom corners sit exactly on them.
 */
function RailJoints() {
  return (
    <>
      <RailJoint className="left-0 -translate-x-1/2" />
      <RailJoint className="right-0 translate-x-1/2" />
    </>
  );
}

function RailJoint({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute -bottom-px hidden size-1.5 translate-y-1/2 sm:block",
        className,
      )}
    >
      <span className="absolute top-0 left-1/2 h-full w-px -translate-x-1/2 bg-border" />
      <span className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-border" />
    </span>
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
      className="underline hover:text-foreground transition-colors"
    >
      skills.sh
    </a>
  );
}
