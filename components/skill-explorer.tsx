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
  FireIcon,
  ArrowRight02Icon,
  CheckmarkBadge01Icon,
  TextAlignLeftIcon,
} from "@hugeicons/core-free-icons";
import {
  modeParser,
  searchQueryParser,
  repoUrlParser,
  catalogSortParser,
  officialFilterParser,
  publisherParser,
  auditFilterParser,
  minInstallsParser,
  searchDescriptionsParser,
  brokenFilterParser,
  leaderboardViewParser,
  type ModeValue,
  type CatalogSortValue,
  type AuditFilterValue,
  type LeaderboardViewValue,
} from "@/lib/search-params";
import type { FacetCount, SkillFilters } from "@/lib/search/typesense";
import { Input } from "@/components/ui/cubby-ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/cubby-ui/input-group";
import { Separator } from "@/components/ui/cubby-ui/separator";
import { Card } from "@/components/ui/cubby-ui/card";
import { Kbd } from "@/components/ui/cubby-ui/kbd";
import { Button } from "@/components/ui/cubby-ui/button";
import { DotMatrixRipple } from "@/components/ui/dot-matrix-ripple";
import { PopularList, rowToSkill } from "@/components/default-skills-list";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/cubby-ui/toggle-group";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/cubby-ui/tooltip";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
} from "@/components/ui/cubby-ui/sheet";
import { CatalogControls, SortSelect } from "@/components/catalog-controls";
import { ActiveCatalogResults } from "@/components/catalog-results";
import { LeaderboardSheet } from "@/components/leaderboard-sheet";
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
  const [publisher, setPublisher] = useQueryState(
    "pub",
    publisherParser.withOptions({ startTransition }),
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
  // Leaderboard sheet: null = closed, "hot"/"trending" = open on that tab.
  // URL-backed (?view=) so a leaderboard is shareable and back closes it.
  const [view, setView] = useQueryState("view", leaderboardViewParser);

  return (
    <SkillExplorerView
      view={view}
      onViewChange={setView}
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
      publisher={publisher}
      onPublisherChange={setPublisher}
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
  view: LeaderboardViewValue | null;
  onViewChange: (view: LeaderboardViewValue | null) => void;
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
  publisher: string[];
  onPublisherChange: (v: string[]) => void;
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
  view: null,
  onViewChange: noop,
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
  publisher: [],
  onPublisherChange: noop,
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
  view,
  onViewChange,
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
  publisher,
  onPublisherChange,
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
    publisher.length > 0 ||
    audit !== null ||
    minInstalls !== null ||
    broken ||
    sortParam !== null;
  const isRepo = mode === "repo";
  const searchActive = !isRepo && (hasQuery || anyFilter);

  const effectiveSort: CatalogSortValue =
    sortParam ?? (hasQuery ? "relevance" : "installs");
  const filters: SkillFilters = {
    officialOnly: official || undefined,
    owners: publisher.length > 0 ? publisher : undefined,
    audit: audit ?? undefined,
    minInstalls: minInstalls ?? undefined,
    // Always hide skills.sh-flagged forks/copies (parity with the cached
    // Popular query's `!isDuplicate`). No user toggle: the flag is unset across
    // the whole catalog today, so a control would do nothing — see
    // docs/search-overhaul.md. Kept here so it auto-applies if it ever populates.
    hideForks: true,
    excludeBroken: broken || undefined,
  };

  // One-tap reset of the chin filters (sort stays — it's a view preference,
  // not a narrowing; Official stays too — its desktop control lives in the
  // input row with its own visible pressed state, so the chin's Clear doesn't
  // reach it). Setting each param to its parser default removes it from the
  // URL, which also drops the page back to the entry state.
  function handleClearFilters() {
    onPublisherChange([]);
    onAuditChange(null);
    onMinInstallsChange(null);
    onBrokenChange(false);
  }

  // The mobile sheet's Clear: Official's mobile home IS the sheet, so the
  // sheet-level reset includes it (Clear covers the controls that share its
  // surface). Search scope is a preference, never cleared.
  function handleClearSheetFilters() {
    handleClearFilters();
    onOfficialChange(false);
  }

  // Choosing the sort the UI would auto-resolve to anyway clears the param, so
  // the URL only carries explicit deviations and "sort: installs with nothing
  // else" stays the entry state instead of needlessly activating Typesense.
  function handleSortChange(next: CatalogSortValue) {
    const autoDefault: CatalogSortValue = hasQuery ? "relevance" : "installs";
    onSortParamChange(next === autoDefault ? null : next);
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
      searchDescriptions={searchDescriptions}
      onSearchDescriptionsChange={onSearchDescriptionsChange}
      publisher={publisher}
      onPublisherChange={onPublisherChange}
      audit={audit}
      onAuditChange={onAuditChange}
      minInstalls={minInstalls}
      onMinInstallsChange={onMinInstallsChange}
      broken={broken}
      onBrokenChange={onBrokenChange}
      onClearFilters={handleClearFilters}
      facets={facets}
      layout={layout}
    />
  );

  // Mobile "Sort & filter" badge + the sheet header's Clear — counts what the
  // sheet contains, so Official is included here (unlike the desktop chin).
  const filterCount =
    (official ? 1 : 0) +
    (publisher.length > 0 ? 1 : 0) +
    (audit ? 1 : 0) +
    (minInstalls !== null ? 1 : 0) +
    (broken ? 1 : 0);

  // The search input — shared by text + repo mode. `inGroup` renders the
  // InputGroup flavor of the input (transparent, borderless — the group
  // supplies the chrome + focus ring); repo mode keeps the standalone
  // bordered Input.
  const searchField = (inputClassName?: string, inGroup = false) => {
    const InputComponent = inGroup ? InputGroupInput : Input;
    return (
      <div className={cn("relative", inGroup ? "w-full" : "flex-1")}>
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
        <InputComponent
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
  };

  return (
    <>
      {/* Framed discovery column. On desktop faint vertical rails flank the
          hero + search + list, and the search's full-bleed border-b meets them
          at a small crosshair — a restrained technical frame that gives the page
          structure. Mobile drops the rails; only the horizontal separator under
          the search remains. */}
      <div className="relative pb-20 sm:min-h-[calc(100dvh-3.5rem)] sm:border-x sm:border-rail sm:px-8 lg:px-10">
        {/* Hero — constant, scrolls away (never collapses). */}
        <section className="pt-10 pb-6 sm:pt-12">
          <h1 className="font-display text-3xl font-medium tracking-tight text-balance sm:text-4xl">
            Pick skills.{" "}
            <span className="text-primary">Ship one install command.</span>
          </h1>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
            Search and compare skills for Cursor, Claude Code, and other coding
            agents. Bundle the ones you want and share the whole set with a
            link.
          </p>
        </section>

        {isRepo ? (
          <>
            {/* Search bar — repo mode. Flat sticky toolbar (no card): bordered
                input + primary Analyze + a way back to search, over one full-bleed
                border-b that meets the desktop rails. */}
            <div className="sticky top-14 z-30 -mx-4 border-b border-rail bg-background/80 px-4 py-3 backdrop-blur-sm sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
              <RailDots />
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
          <>
            {/* Search bar — text mode. A two-layer "composer" card: the inner
                surface holds the input + how-you-search controls (scope tabs,
                Match repo, sort); the chin below holds the result-narrowing
                filters + the leaderboards entry. Everything inside it
                parametrizes the ONE list below — Trending/Hot live in their own
                sheet, so no control here ever points at a list it doesn't
                affect. */}
            <div className="sticky top-14 z-30 -mx-4 border-b border-rail bg-background/80 px-4 py-3 backdrop-blur-sm sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
              <RailDots />
              <Card variant="inset" className="p-1 pb-0">
                {/* Inner surface — the search instrument. The InputGroup owns
                    the input behavior + focus ring; its chrome matches the
                    inset Card's inner panel (borderless — elevation shadow +
                    rim instead of a 1px line), and --popup-surface is set so
                    elevated components nested inside composite against the
                    right substrate. The block-end addon is its control row:
                    search scope left, repo-match + sort right. */}
                <InputGroup className="border-0 shadow-[var(--surface-shadow-3),var(--surface-rim-3)] [--popup-surface:var(--surface-3)]">
                  {searchField("h-11", true)}
                  <InputGroupAddon
                    align="block-end"
                    className="justify-between gap-2 px-2 pb-2 max-sm:hidden"
                  >
                    {/* Icon toggle group — the two high-frequency booleans, on
                        the instrument itself (independent multiple-selection,
                        one collapsed frame). Icon-only, so tooltips + a loud
                        pressed state are load-bearing, not decoration. */}
                    {/* Desktop-only: icon toggles need hover for their
                        tooltips; on mobile these live in the Sort & filter
                        sheet as labeled switches. */}
                    <ToggleGroup
                      multiple
                      detached
                      size="sm"
                      variant="outline"
                      aria-label="Search options"
                      className="max-sm:hidden"
                      value={[
                        ...(official ? ["official"] : []),
                        ...(searchDescriptions ? ["desc"] : []),
                      ]}
                      onValueChange={(vals: string[]) => {
                        onOfficialChange(vals.includes("official"));
                        onSearchDescriptionsChange(vals.includes("desc"));
                      }}
                    >
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <ToggleGroupItem
                              value="official"
                              aria-label="Official skills only"
                              // Re-assert the slot the TooltipTrigger merge
                              // overwrites — the group's cell styling targets
                              // [data-slot=toggle].
                              data-slot="toggle"
                            />
                          }
                        >
                          <HugeiconsIcon
                            icon={CheckmarkBadge01Icon}
                            strokeWidth={2}
                            className={cn(
                              "size-4",
                              official
                                ? "text-info-foreground"
                                : "text-muted-foreground",
                            )}
                          />
                        </TooltipTrigger>
                        <TooltipContent sideOffset={8}>
                          Official skills only
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <ToggleGroupItem
                              value="desc"
                              aria-label="Also search descriptions"
                              data-slot="toggle"
                            />
                          }
                        >
                          <HugeiconsIcon
                            icon={TextAlignLeftIcon}
                            strokeWidth={2}
                            className={cn(
                              "size-4",
                              searchDescriptions
                                ? "text-foreground"
                                : "text-muted-foreground",
                            )}
                          />
                        </TooltipTrigger>
                        <TooltipContent sideOffset={8}>
                          Also search descriptions
                        </TooltipContent>
                      </Tooltip>
                    </ToggleGroup>
                    {/* ms-auto keeps this pinned right on mobile, where the
                        (hidden) toggle group stops participating in the row. */}
                    <div className="ms-auto flex items-center gap-1">
                      <InputGroupButton
                        size="sm"
                        className="shrink-0 text-muted-foreground"
                        onClick={() => onModeChange("repo")}
                        leftSection={
                          <HugeiconsIcon
                            icon={GithubIcon}
                            strokeWidth={2}
                            className="size-3.5"
                          />
                        }
                      >
                        Match my repo
                      </InputGroupButton>
                      <Separator
                        orientation="vertical"
                        className="h-4! max-sm:hidden"
                      />
                      <SortSelect
                        sort={effectiveSort}
                        hasQuery={hasQuery}
                        onSortChange={handleSortChange}
                        ghost
                        className="max-sm:hidden"
                      />
                    </div>
                  </InputGroupAddon>
                </InputGroup>

                {/* Chin: filters left, leaderboards entry right. On mobile the
                    filters collapse to one trigger → bottom sheet (sort lives
                    inside the sheet there, since the control row hides it). */}
                <div className="flex items-center justify-between gap-x-3 gap-y-2 py-1 px-2 ">
                  <div className="hidden min-w-0 sm:flex sm:items-center sm:gap-1.5 sm:flex-wrap">
                    {controls(facets)}
                  </div>
                  {/* Mobile: the whole control row above is hidden, so its two
                      homes here are the sheet (sort/filters/switches) and a
                      chin-level Match my repo. */}
                  <div className="flex items-center gap-0.5 sm:hidden">
                    <Sheet>
                      <SheetTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground"
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
                        {/* Clear lives in the header (stable slot) so its
                            appearance never shifts the sheet's content. */}
                        <SheetHeader className="flex-row items-center justify-between">
                          <SheetTitle>Sort &amp; filter</SheetTitle>
                          {filterCount > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground"
                              onClick={handleClearSheetFilters}
                              leftSection={
                                <HugeiconsIcon
                                  icon={Cancel01Icon}
                                  strokeWidth={2}
                                  className="size-3.5"
                                />
                              }
                            >
                              Clear ({filterCount})
                            </Button>
                          )}
                        </SheetHeader>
                        <SheetBody>{controls(facets, "sheet")}</SheetBody>
                      </SheetContent>
                    </Sheet>
                  </div>
                  {/* Right pair: repo matching + leaderboards. Mobile gets
                      dedicated square icon buttons (flame/GitHub are safe bare
                      glyphs, and both open surfaces that explain themselves);
                      desktop gets the labeled Trending button — Match my repo
                      lives in the control row there. */}
                  <div className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon_sm"
                      className="text-muted-foreground sm:hidden"
                      onClick={() => onModeChange("repo")}
                      aria-label="Match my repo"
                    >
                      <HugeiconsIcon
                        icon={GithubIcon}
                        strokeWidth={2}
                        className="size-4"
                      />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon_sm"
                      className="sm:hidden"
                      onClick={() => onViewChange("hot")}
                      aria-label="Hot + Trending leaderboards"
                    >
                      <HugeiconsIcon
                        icon={FireIcon}
                        strokeWidth={2}
                        className="size-4 text-warning-foreground"
                      />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-muted-foreground max-sm:hidden"
                      onClick={() => onViewChange("hot")}
                      leftSection={
                        <HugeiconsIcon
                          icon={FireIcon}
                          strokeWidth={2}
                          className="size-3.5 text-warning-foreground"
                        />
                      }
                      rightSection={
                        <HugeiconsIcon
                          icon={ArrowRight02Icon}
                          strokeWidth={2}
                          className="size-3.5"
                        />
                      }
                    >
                      Hot + Trending
                    </Button>
                  </div>
                </div>
              </Card>
            </div>

            {/* List region — the ONLY thing that changes on interaction. */}
            <div className="pt-4">
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
            </div>
          </>
        )}
      </div>

      {/* BundleBar is mounted by the (main) layout (GlobalBundleBar) so its
          state persists across navigation to /compare. */}
      <SkillDetailSheet handle={skillDetailHandle} />
      <LeaderboardSheet
        view={view}
        onViewChange={onViewChange}
        hotSkills={hotSkills}
        trendingSkills={trendingSkills}
        sheetHandle={skillDetailHandle}
      />
    </>
  );
}

/**
 * A small dot at each junction where the sticky bar's border-b meets a desktop
 * rail — a quiet node tying the horizontal separator to the vertical frame.
 * The `-0.5px` insets push the dot's center off the bar's *padding-box* corner
 * onto the border *centerlines* (the corner sits half a 1px border inside both
 * the rail and the separator, which otherwise biases the dot inward + up).
 * Part of the sticky bar, so it tracks the bar on scroll. Desktop-only.
 */
function RailDots() {
  return (
    <>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-[0.5px] -left-[0.5px] hidden size-2 -translate-x-1/2 translate-y-1/2 rounded-full bg-rail sm:block"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-[0.5px] -right-[0.5px] hidden size-2 translate-x-1/2 translate-y-1/2 rounded-full bg-rail sm:block"
      />
    </>
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
