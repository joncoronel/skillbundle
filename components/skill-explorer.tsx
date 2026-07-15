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
  ArrowLeft02Icon,
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
import { useQueryClient } from "@tanstack/react-query";
import { catalogSearchQueryKey } from "@/hooks/use-catalog-search";
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
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
  DrawerBody,
} from "@/components/ui/cubby-ui/drawer/drawer";
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

  // Reported up from ActiveCatalogResults (debounce + Typesense fetch). Feeds
  // showInputSpinner, which is derived below the filters (it needs them for
  // the cache check).
  const [searchQueryPending, setSearchQueryPending] = useState(false);

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

  // In-input search spinner, fully derived (same pattern as explore's
  // isInputLoading): `!inputQueryCached` makes it cache-aware — a retype of a
  // cached query shows no spinner at all (the results swap synchronously via
  // useCatalogSearch's cache bypass, so a spinner would be a lie) — while the
  // `trimmed !== deferredTrimmed` term lights it on the SAME render as an
  // uncached keystroke, covering the gap until ActiveCatalogResults mounts and
  // starts reporting `searchQueryPending`. Gated on a non-empty query so a
  // filter-only load doesn't spin an empty box.
  const queryClient = useQueryClient();
  const inputQueryCached =
    hasQuery &&
    queryClient.getQueryData(
      catalogSearchQueryKey(
        trimmed,
        effectiveSort,
        filters,
        searchDescriptions,
      ),
    ) !== undefined;
  const showInputSpinner =
    mode !== "repo" &&
    hasQuery &&
    !inputQueryCached &&
    (searchQueryPending || trimmed !== deferredTrimmed);

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
  // Pre-submit validation feedback: true after an Analyze attempt on a value
  // that isn't repo-shaped. Rendered in the chin's helper slot (role=alert);
  // cleared on the next keystroke.
  const [repoInputInvalid, setRepoInputInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // One repo-shape test for carry-over AND pre-submit validation: a GitHub
  // URL or a bare owner/repo slug.
  function looksLikeRepo(value: string) {
    return (
      /^(https?:\/\/)?(www\.)?github\.com\/[\w.-]+\/[\w.-]+/i.test(value) ||
      /^[\w.-]+\/[\w.-]+$/.test(value)
    );
  }

  // Entering repo mode keeps the composer card; only the contents morph. If
  // what's typed already looks like a repo (URL or owner/repo), carry it into
  // the repo input so the click doesn't discard it.
  function enterRepoMode() {
    const t = textQuery.trim();
    if (looksLikeRepo(t)) {
      setRepoInput(t);
    }
    onModeChange("repo");
    inputRef.current?.focus();
  }

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
    // Validate BEFORE submitting: junk never enters the shareable URL or
    // burns an analysis round-trip. The chin explains with a format example.
    if (!looksLikeRepo(submitted)) {
      setRepoInputInvalid(true);
      return;
    }
    setRepoInputInvalid(false);
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
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isRepo) {
      setRepoInput(e.target.value);
      // A new keystroke is a new attempt — drop the stale validation error.
      if (repoInputInvalid) setRepoInputInvalid(false);
    } else {
      onTextQueryChange(e.target.value);
    }
  };
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isRepo) return;
    if (e.key === "Enter") handleRepoSubmit();
    // Esc on an empty repo input backs out to search (same as "Search skills").
    if (e.key === "Escape" && !repoInput.trim()) onModeChange("text");
  };
  const handleClearInput = () => {
    if (isRepo) {
      setRepoInput("");
      onRepoUrlChange("");
    } else {
      onTextQueryChange("");
    }
  };

  // The composer's input row, shared by both modes — the docs' addon anatomy
  // (icon addon + input + trailing addon). Mode changes the icon, the
  // placeholder, and the trailing addon's 32px control (toggles vs Analyze);
  // the input element itself is identical in both modes, so focus survives
  // the switch.
  const searchField = (inputClassName?: string) => (
    <div className="flex w-full items-center">
      <InputGroupAddon>
        {showInputSpinner ? (
          <DotMatrixRipple size="xs" ariaLabel="Searching" />
        ) : (
          <HugeiconsIcon
            icon={isRepo ? GithubIcon : Search01Icon}
            strokeWidth={2}
          />
        )}
      </InputGroupAddon>
      <InputGroupInput
        ref={inputRef}
        placeholder={placeholder}
        value={inputValue}
        onChange={handleInputChange}
        onKeyDown={handleInputKeyDown}
        className={cn("pl-2", inputClassName)}
      />
      {/* The field is deliberately 44px (hero scale), so the 32px controls
          here sit INSIDE the input's own height with the addon's standard
          padding — nothing inflates the row. Clear/kbd come first (they
          relate to the text); the toggles / Analyze own the corner. */}
      <InputGroupAddon align="inline-end">
        {/* Clear matches the toggles' 32px control scale (it IS a button);
            the kbd sits one step under it at 28px — keyboard chips read
            naturally a touch smaller than buttons, but not toy-sized. The
            fixed 32px slot keeps the kbd⇄clear swap from nudging the
            toggles sideways (their widths differ by ~4px). */}
        {(inputValue || !isRepo) && (
          // This wrapper is the load-bearing part, not its size: with kbd /
          // clear nested (not direct addon children), the addon's
          // has-[>kbd] / has-[>button] conditional pulls never match, so the
          // addon's right margin stays constant and the toggles don't shift
          // when the two swap. The width difference between them is absorbed
          // by the flexible input on the left.
          <div className="flex shrink-0 items-center">
            {inputValue ? (
              <InputGroupButton
                size="icon_sm"
                aria-label="Clear search"
                onClick={handleClearInput}
              >
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  strokeWidth={2}
                  className="size-4"
                />
              </InputGroupButton>
            ) : (
              <Kbd
                size="lg"
                variant="ghost"
                // rounded-md! — the ! is load-bearing: the addon's own
                // [&>kbd]:rounded-[calc(var(--radius)-5px)] rule out-specifies
                // a bare utility. One radius step under the 32px rounded-lg
                // controls beside it, proportional to its one size step under
                // them.
                className="max-sm:hidden rounded-md!"
                aria-hidden="true"
              >
                /
              </Kbd>
            )}
          </div>
        )}
        {/* The two high-frequency search booleans, on the instrument itself
            (independent multiple-selection, detached cells at the standard
            32px control size — default radius, no overrides). Desktop-only:
            the desc toggle needs hover for its tooltip; on mobile both live
            in the Sort & filter sheet as labeled switches. Hidden in repo
            mode — they don't apply to repo matching. */}
        {!isRepo && (
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
            {/* Official carries a visible label — it's the product's flagship
                filter (a nav item and a per-row badge share the word), so its
                control shouldn't be recall-dependent iconography. */}
            <ToggleGroupItem
              value="official"
              aria-label="Official skills only"
              className="gap-1.5 px-2 text-sm"
            >
              <HugeiconsIcon
                icon={CheckmarkBadge01Icon}
                strokeWidth={2}
                className={cn(
                  "size-4",
                  official ? "text-info-foreground" : "text-muted-foreground",
                )}
              />
              Official
            </ToggleGroupItem>
            <Tooltip>
              <TooltipTrigger
                render={
                  <ToggleGroupItem
                    value="desc"
                    aria-label="Also search descriptions"
                    // Re-assert the slot the TooltipTrigger merge overwrites —
                    // the group's cell styling targets [data-slot=toggle].
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
        )}
        {/* Repo mode's submit lives inline in the field (URL-bar pattern) —
            the one-field form doesn't need a second row for it. Standard sm
            (32px) control, same as the toggles it replaces: a real click
            target that still sits inside the 44px field. starting: fades it
            in on the morph. */}
        {isRepo && (
          <InputGroupButton
            variant="primary"
            size="sm"
            className="shrink-0 starting:opacity-0 transition-opacity duration-240 ease-out-cubic motion-reduce:transition-none"
            onClick={handleRepoSubmit}
            disabled={!repoInput.trim() || !canAutoDetect}
            leftSection={
              <HugeiconsIcon
                icon={FlashIcon}
                strokeWidth={2}
                className="size-3.5"
              />
            }
          >
            Analyze
          </InputGroupButton>
        )}
      </InputGroupAddon>
    </div>
  );

  return (
    <>
      {/* Framed discovery column. On desktop faint vertical rails flank the
          hero + search + list, and the search's full-bleed border-b meets them
          at a small crosshair — a restrained technical frame that gives the page
          structure. Mobile drops the rails; only the horizontal separator under
          the search remains. */}
      <div className="relative pb-20 sm:min-h-[calc(100dvh-3.5rem)] sm:px-8 lg:px-10">
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

        {/* Search bar — one two-layer "composer" card shared by BOTH modes:
            the inner surface is a single input row (icon, field, and inline
            trailing controls at the group's 24px inner scale: scope toggles
            in search mode, Analyze in repo mode); the chin holds the list
            controls (filters + sort) and the
            navigation corner (Hot/Trending, the mode switch). The mode morph
            is pure content swaps — icon, placeholder, trailing control, chin
            contents — with NO height change, so the card never jumps.
            Everything inside it parametrizes the ONE region below — search
            mode gets the catalog list, repo mode gets match results. */}
        <div className="sticky top-14 z-30 -mx-4 px-4 py-3 sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
          <Card variant="inset" className="p-1 pb-0">
            {/* Inner surface — the search instrument. The InputGroup owns
                    the input behavior + focus ring; its chrome matches the
                    inset Card's inner panel (borderless — elevation shadow +
                    rim instead of a 1px line), and --popup-surface is set so
                    elevated components nested inside composite against the
                    right substrate. The block-end addon is its control row:
                    search scope left, repo-match + sort right. */}
            <InputGroup className="border-0 shadow-[var(--surface-shadow-3),var(--surface-rim-3)] [--popup-surface:var(--surface-3)]">
              {/* h-11 at BOTH breakpoints: the Input's own sm:h-9 would win
                  the merge over a bare h-11 (the field silently rendered
                  36px for months because of this trap). 44px is the hero
                  scale on purpose — the 32px trailing controls sit inside
                  the field's height instead of inflating the row. */}
              {searchField("h-11 sm:h-11")}
            </InputGroup>

            {/* Chin: filters left, leaderboards entry right. On mobile the
                    filters collapse to one trigger → bottom sheet (sort lives
                    inside the sheet there, since the control row hides it). */}
            {/* px-3 sets the chin on the same 12px line; its edge controls
                    are all ghost, so each pulls its glyph/text onto the line
                    with a negative margin (the addon idiom). */}
            {/* The chin persists in BOTH modes — the card's two-layer
                    silhouette is its identity. Repo mode swaps its contents:
                    back to search (navigation belongs at chin level, like the
                    Hot + Trending link) plus a helper line explaining what
                    Analyze reads. Same height either way, so only the control
                    row above changes the card's height. */}
            {/* flex-wrap here (and nowhere inside): at tight widths the whole
                right pair drops to its own row instead of the filters wrapping
                internally while the right pair floats between their lines. */}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1 px-3">
              {isRepo ? (
                <>
                  {/* Helper slot doubles as the validation slot: an invalid
                      Analyze attempt swaps the hint for an error with a format
                      example (role=alert announces it). The error shows on
                      mobile too — it's actionable, unlike the ambient hint. */}
                  {repoInputInvalid ? (
                    <p
                      role="alert"
                      className="min-w-0 text-xs text-destructive"
                    >
                      Enter a GitHub repo URL, like github.com/vercel/next.js
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground max-sm:hidden starting:opacity-0 transition-opacity duration-240 ease-out-cubic motion-reduce:transition-none">
                      Reads languages and packages from public repos
                    </p>
                  )}
                  {/* Same corner as "Match my repo" in search mode — the mode
                      switch lives in one stable spot. ms-auto keeps it pinned
                      right on mobile, where the helper text is hidden. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ms-auto -me-2 shrink-0 text-muted-foreground starting:opacity-0 transition-opacity duration-240 ease-out-cubic motion-reduce:transition-none"
                    onClick={() => onModeChange("text")}
                    leftSection={
                      <HugeiconsIcon
                        icon={ArrowLeft02Icon}
                        strokeWidth={2}
                        className="size-3.5"
                      />
                    }
                  >
                    Search skills
                  </Button>
                </>
              ) : (
                <>
                  <div className="hidden min-w-0 sm:flex sm:items-center sm:gap-1.5">
                    {controls(facets)}
                  </div>
                  {/* Mobile: the whole control row above is hidden, so its two
                      homes here are the sheet (sort/filters/switches) and a
                      chin-level Match my repo. */}
                  <div className="flex items-center gap-0.5 sm:hidden">
                    <Drawer direction="bottom">
                      <DrawerTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground -ms-2"
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
                      </DrawerTrigger>
                      <DrawerContent>
                        <DrawerHandle />
                        <DrawerHeader>
                          {/* Fixed-height title row: min-h-9 reserves the Clear
                              button's height (size="sm" = h-9 on mobile) so it can
                              appear/disappear without shifting the sheet's content. */}
                          <div className="flex min-h-9 items-center justify-between gap-2">
                            <DrawerTitle>Sort &amp; filter</DrawerTitle>
                            {filterCount > 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="-me-2 text-muted-foreground"
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
                          </div>
                        </DrawerHeader>
                        <DrawerBody>{controls(facets, "sheet")}</DrawerBody>
                      </DrawerContent>
                    </Drawer>
                  </div>
                  {/* Right pair: leaderboards + repo matching — the chin's
                      "go places" corner on every breakpoint. Match my repo is
                      outermost with a → : the arrows are the mode-switch
                      grammar ("Match my repo →" enters the flow, "← Search
                      skills" exits it, both in this same corner). Mobile gets
                      dedicated square icon buttons (flame/GitHub are safe
                      bare glyphs, and both open surfaces that explain
                      themselves) in the same order. ms-auto keeps the pair
                      right-aligned when it wraps to its own row (justify-
                      between only spaces items sharing a line). */}
                  <div className="ms-auto flex items-center gap-0.5">
                    {/* Sort — a result-view preference, so it lives with the
                        chin's other list controls, right-aligned above the
                        list it orders (and next to the results its Relevance
                        auto-swap concerns). Mobile keeps sort in the sheet. */}
                    <SortSelect
                      sort={effectiveSort}
                      hasQuery={hasQuery}
                      onSortChange={handleSortChange}
                      ghost
                      className="max-sm:hidden"
                    />
                    <Separator
                      orientation="vertical"
                      className="h-4! mx-1 max-[860px]:hidden"
                    />
                    {/* The icon squares cover BOTH the mobile layout and the
                        640-860px desktop band (wider now that sort shares the chin) where even the short labels
                        don't fit next to the filters — icons instead of a
                        wrapped second chin row. */}
                    <Button
                      variant="ghost"
                      size="icon_sm"
                      className="min-[860px]:hidden"
                      onClick={() => onViewChange("hot")}
                      aria-label="Hot/Trending leaderboards"
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
                      className="shrink-0 text-muted-foreground max-[860px]:hidden"
                      onClick={() => onViewChange("hot")}
                      leftSection={
                        <HugeiconsIcon
                          icon={FireIcon}
                          strokeWidth={2}
                          className="size-3.5 text-warning-foreground"
                        />
                      }
                    >
                      Hot/Trending
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon_sm"
                      className="text-muted-foreground min-[860px]:hidden -me-2.5"
                      onClick={enterRepoMode}
                      aria-label="Match repo"
                    >
                      <HugeiconsIcon
                        icon={GithubIcon}
                        strokeWidth={2}
                        className="size-4"
                      />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-muted-foreground max-[860px]:hidden -me-2"
                      onClick={enterRepoMode}
                      leftSection={
                        <HugeiconsIcon
                          icon={GithubIcon}
                          strokeWidth={2}
                          className="size-3.5"
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
                      Match repo
                    </Button>
                  </div>
                </>
              )}
            </div>
          </Card>
        </div>

        {isRepo ? (
          /* Repo mode's region: match results (or the paste-a-repo empty
             state). starting: fades it in on the mode morph — it only mounts
             on entry, so the static shell never sees the fade. */
          <div className="pt-4 starting:opacity-0 transition-opacity duration-240 ease-out-cubic motion-reduce:transition-none">
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
        ) : (
          <>
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
