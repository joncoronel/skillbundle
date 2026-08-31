"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  SquareLock02Icon,
} from "@hugeicons/core-free-icons";
import { Autocomplete as BaseAutocomplete } from "@base-ui/react/autocomplete";
import {
  AutocompletePortal,
  AutocompletePositioner,
  AutocompletePopup,
  AutocompleteList,
  AutocompleteItem,
  AutocompleteEmpty,
  AutocompleteCollection,
  AutocompleteStatus,
  useAutocompleteFilter,
} from "@/components/ui/cubby-ui/autocomplete";
import { useMyRepos } from "@/hooks/use-my-repos";
import type { MyRepo } from "@/convex/githubAccount";
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
import { Spinner } from "@/components/ui/spinner";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/cubby-ui/toggle-group";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  createTooltipHandle,
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
import {
  CatalogControlsBar,
  CatalogControlsSheet,
  FilterCountBadge,
  SortSelect,
} from "@/components/catalog-controls";
import { useExplorerState } from "@/components/explorer-state";
import { extractRepoSlug } from "@/lib/repo-match";
import { cn } from "@/lib/utils";

// One repo-shape test for carry-over AND pre-submit validation, delegating to
// the canonical parser so "repo-shaped" here matches what the server accepts.
function looksLikeRepo(value: string) {
  return extractRepoSlug(value) !== null;
}

// Stable empty list for the modes/states where repo suggestions don't apply,
// so the Autocomplete root's `items` identity doesn't churn per render.
const NO_REPOS: MyRepo[] = [];

// One tooltip shared by both scope toggles, addressed by handle. A single
// popup means moving between the two adjacent cells morphs the existing label
// (width/height + crossfade) instead of unmounting one tooltip and opening
// another — the swap Base UI calls "instant" inside a provider group.
// Created PER COMPOSER (see useMemo below), not at module scope: a re-suspend
// of the home page's boundary hides the live tree rather than unmounting it,
// so two composers can be mounted at once, and a module handle would have both
// of them registering triggers and a popup on the same store.
function createScopeTooltip() {
  return createTooltipHandle<string>();
}

/**
 * The two scope booleans, as data. `label` is the full phrase, used for BOTH
 * the tooltip payload and the accessible name. `short` is the word rendered
 * beside the icon on a coarse pointer, and it stays in this table beside its
 * own label because WCAG 2.5.3 wants the accessible name to contain the
 * visible one: each short form is a substring of the label above it.
 */
const SCOPE_OPTIONS = [
  {
    value: "official",
    icon: CheckmarkBadge01Icon,
    label: "Official skills only",
    short: "Official",
    // Split by theme because the two blues sit differently against
    // --muted-foreground: --primary measures 1.55:1 in light, while in dark
    // --info-foreground lands at 1.04:1. Blue carries only 0.0722 of
    // luminance, so no blue separates from a mid grey there; in dark the
    // pressed plate (1.36:1) is what carries the state. Parked with the
    // measurements and the lever in TODO.md, beside the focus-ring and
    // switch-track entries it is a sibling of.
    activeClass: "text-primary dark:text-info-foreground",
  },
  {
    value: "desc",
    icon: TextAlignLeftIcon,
    label: "Also search descriptions",
    short: "Descriptions",
    activeClass: "text-foreground",
  },
] as const;

type ScopeValue = (typeof SCOPE_OPTIONS)[number]["value"];

/**
 * One cell of the scope track. Everything except the five fields in
 * SCOPE_OPTIONS is identical between them, and it was previously copied.
 * Renders no DOM of its own, so the cells stay direct children of the group
 * and its end-cap radius and `::after` dividers still resolve.
 */
function ScopeToggle({
  option,
  active,
  handle,
}: {
  option: (typeof SCOPE_OPTIONS)[number];
  active: boolean;
  handle: ReturnType<typeof createScopeTooltip>;
}) {
  return (
    <TooltipTrigger
      handle={handle}
      payload={option.label}
      // Base UI closes on click by default, which pulls the label off screen
      // on the very click that flips the state, while the pointer is still on
      // the cell. The label is the only thing naming an icon-only control.
      closeOnClick={false}
      render={
        <ToggleGroupItem
          value={option.value}
          aria-label={option.label}
          // Re-assert the slot the TooltipTrigger merge overwrites — the
          // group's cell styling targets [data-slot=toggle].
          data-slot="toggle"
        />
      }
    >
      <HugeiconsIcon
        icon={option.icon}
        strokeWidth={2}
        className={cn(
          "size-4",
          active ? option.activeClass : "text-muted-foreground",
        )}
      />
      {/* An icon-only control that needs hover to explain itself is only
          legible where hover exists. `pointer-coarse` is the primary-input
          media query, so a tablet gets the word and a touch LAPTOP (fine
          pointer, mouse present) keeps the icon. Purely visual: aria-label
          already names the cell, so this span never changes what a screen
          reader hears. */}
      <span className="hidden pointer-coarse:block">{option.short}</span>
    </TooltipTrigger>
  );
}

// Cap on rendered suggestions (the server list caps at 200; nobody scrolls
// that in a popup — they type). A Status line reports what's hidden.
const SUGGESTION_LIMIT = 60;

interface SkillComposerProps {
  /** Derived in SkillExplorer from the shared query cache. */
  showInputSpinner: boolean;
}

/**
 * The sticky search "composer" — one two-layer card shared by BOTH modes:
 * the inner surface is a single input row (icon, field, and inline trailing
 * controls: scope toggles in search mode, Analyze in repo mode); the chin
 * holds the list controls (filters + sort) and the navigation corner
 * (Hot/Trending, the mode switch). The mode morph is pure content swaps —
 * icon, placeholder, trailing control, chin contents — with NO height change,
 * so the card never jumps.
 *
 * URL state comes from the explorer context; the only local state is the repo
 * field's draft (pushed to the URL on submit) and its validation flag.
 */
export function SkillComposer({ showInputSpinner }: SkillComposerProps) {
  // Per instance, not module scope — see createScopeTooltip above.
  const scopeTooltip = useMemo(() => createScopeTooltip(), []);
  const {
    textQuery,
    repoUrl,
    isRepo,
    official,
    searchDescriptions,
    setParams,
  } = useExplorerState();

  // The one per-option fact that cannot live in SCOPE_OPTIONS, since it comes
  // from the hook. Typed as a Record over the table's own value union, so
  // adding an option without wiring its boolean is a compile error instead of
  // a silent fall-through to whichever branch happened to be last.
  const scopeActive: Record<ScopeValue, boolean> = {
    official,
    desc: searchDescriptions,
  };

  // Local draft for the repo field — only pushed to the URL on submit. When
  // the URL's repo changes from elsewhere (the empty state's "Try it on …"
  // example, back/forward), the draft adopts it — render-time sync, no effect.
  const [repoDraft, setRepoDraft] = useState(repoUrl);
  const [lastRepoUrl, setLastRepoUrl] = useState(repoUrl);
  if (repoUrl !== lastRepoUrl) {
    setLastRepoUrl(repoUrl);
    setRepoDraft(repoUrl);
  }

  // Pre-submit validation feedback: true after an Analyze attempt on a value
  // that isn't repo-shaped. Rendered in the chin's helper slot (role=alert);
  // cleared on the next keystroke.
  const [repoInputInvalid, setRepoInputInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Repo suggestions: the input doubles as an autocomplete over the user's
  // own repos once their GitHub connection is healthy (connect/grant CTAs
  // live in the empty state below). Everything degrades to the plain URL
  // field when the list isn't available.
  const { repos, account, hasRepoScope, isPro } = useMyRepos();
  const showRepoSuggestions =
    isRepo && isPro && !!account && hasRepoScope && repos.length > 0;

  // Diacritic/case-insensitive matcher, shared by the root's filter and the
  // hidden-count Status line so they can't disagree.
  const { contains } = useAutocompleteFilter({ sensitivity: "base" });

  // The currently highlighted suggestion (arrow keys / hover). Read by the
  // Enter handler so "commit the highlighted repo" and "analyze the typed
  // text" can't both fire from one keypress.
  const highlightedRepoRef = useRef<MyRepo | null>(null);

  // Whether the suggestion popup is open, for the Escape handler. A ref
  // (not state) because it's only read inside keydown: Base UI dismisses
  // the popup from a document-level listener that runs AFTER our
  // root-attached React handler, so `e.defaultPrevented` can never tell us
  // Escape was spent on closing the popup — this flag can.
  const suggestionsOpenRef = useRef(false);

  // Anchor the suggestion popup to the whole InputGroup, not the bare input —
  // otherwise --anchor-width is the input element's width (minus both addons)
  // and the popup renders narrower than the field it belongs to. Same fix as
  // the multi-select combobox's chips anchor.
  const [suggestionsAnchor, setSuggestionsAnchor] =
    useState<HTMLDivElement | null>(null);

  // Matches beyond SUGGESTION_LIMIT are hidden by the root's `limit`; count
  // them here (same matcher) so the Status line can say so instead of the
  // popup silently pretending the list is complete.
  const totalMatches = useMemo(() => {
    if (!showRepoSuggestions) return 0;
    const q = repoDraft.trim();
    if (!q) return repos.length;
    return repos.filter((r) => contains(r.fullName, q)).length;
  }, [showRepoSuggestions, repos, repoDraft, contains]);
  const hiddenCount = Math.max(0, totalMatches - SUGGESTION_LIMIT);

  function selectRepo(repo: MyRepo) {
    setRepoDraft(repo.fullName);
    setRepoInputInvalid(false);
    setParams({ repoUrl: repo.fullName });
  }

  // Entering repo mode keeps the composer card; only the contents morph. If
  // what's typed already looks like a repo (URL or owner/repo), carry it into
  // the repo input so the click doesn't discard it.
  function enterRepoMode() {
    const t = textQuery.trim();
    if (looksLikeRepo(t)) {
      setRepoDraft(t);
    }
    setParams({ mode: "repo" });
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
    const submitted = repoDraft.trim();
    if (!submitted) return;
    // Validate BEFORE submitting: junk never enters the shareable URL or
    // burns an analysis round-trip. The chin explains with a format example.
    if (!looksLikeRepo(submitted)) {
      setRepoInputInvalid(true);
      return;
    }
    setRepoInputInvalid(false);
    setParams({ repoUrl: submitted });
  }

  const inputValue = isRepo ? repoDraft : textQuery;
  const placeholder = isRepo
    ? "https://github.com/owner/repo"
    : "Search skills…";

  // Autocomplete-root value handler — fires for keystrokes AND for Base UI
  // filling the input on a suggestion commit, so both paths stay in sync.
  const handleValueChange = (value: string) => {
    if (isRepo) {
      setRepoDraft(value);
      // A new keystroke is a new attempt — drop the stale validation error.
      if (repoInputInvalid) setRepoInputInvalid(false);
    } else {
      setParams({ textQuery: value });
    }
  };
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isRepo) return;
    if (e.key === "Enter") {
      // A highlighted suggestion wins the keypress: submit it directly
      // (covers keyboard commit regardless of how Base UI sequences the
      // fill), never the half-typed text under it.
      const highlighted = highlightedRepoRef.current;
      if (showRepoSuggestions && highlighted) {
        selectRepo(highlighted);
        return;
      }
      handleRepoSubmit();
    }
    // Esc on an empty repo input backs out to search (same as "Search
    // skills") — but an Esc spent closing the suggestion popup is not also
    // an exit, so it takes two presses from an open popup.
    if (
      e.key === "Escape" &&
      !suggestionsOpenRef.current &&
      !repoDraft.trim()
    ) {
      setParams({ mode: "text" });
    }
  };
  const handleClearInput = () => {
    if (isRepo) {
      setRepoDraft("");
      setParams({ repoUrl: "" });
    } else {
      setParams({ textQuery: "" });
    }
  };

  // The composer's input row, shared by both modes — the docs' addon anatomy
  // (icon addon + input + trailing addon). Mode changes the icon, the
  // placeholder, and the trailing addon's 32px control (toggles vs Analyze);
  // the input element itself is identical in both modes, so focus survives
  // the switch. Built once per render as a value (one call site, so no
  // parameter — the input's fixed height is inlined below).
  const searchField = (
    <div className="flex w-full items-center">
      <InputGroupAddon>
        {showInputSpinner ? (
          <Spinner size="xs" />
        ) : (
          <HugeiconsIcon
            icon={isRepo ? GithubIcon : Search01Icon}
            strokeWidth={2}
          />
        )}
      </InputGroupAddon>
      {/* The Autocomplete root (wrapping the whole InputGroup below) owns
          value + onChange; this render pairing keeps the composer's own
          input styling and ref. */}
      <BaseAutocomplete.Input
        render={
          <InputGroupInput
            ref={inputRef}
            // `aria-busy`, not a live region: the spinner is decorative and
            // the listbox announces its own results.
            aria-busy={showInputSpinner}
            placeholder={placeholder}
            onKeyDown={handleInputKeyDown}
            // h-11 at BOTH breakpoints: the Input's own sm:h-9 would win the
            // merge over a bare h-11 (the field silently rendered 36px for
            // months because of this trap). 44px is the hero scale on purpose
            // — the 32px trailing controls sit inside the field's height
            // instead of inflating the row.
            className={cn("h-11 pl-2 sm:h-11")}
          />
        }
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
                // a bare utility. 10px is also exactly the sm track's own
                // corner (TRACK_RADIUS.sm in toggle-group.tsx), so the chip and
                // the toggles no longer differ by a radius step; the Separator
                // below is what keeps them from reading as one run.
                className="rounded-md! max-sm:hidden"
                aria-hidden="true"
              >
                /
              </Kbd>
            )}
          </div>
        )}
        {/* The two high-frequency search booleans, on the instrument itself
            (independent multiple-selection, one attached solid track at the
            standard 32px control size — default radius, no overrides). Both
            cells are icon-only and share ONE tooltip handle, so
            sliding from one to the other morphs the label in place.
            Desktop-only: the cells are recall-dependent iconography that needs
            hover to explain itself; on mobile both live in the Sort & filter
            sheet as labeled switches. Hidden in repo mode — they don't apply
            to repo matching. */}
        {!isRepo && (
          <>
            {/* The break between the field's own affordances (kbd / clear,
                which act on the text) and the scope instrument. Without it the
                ghost kbd plate reads as a third cell of the toggle track —
                same scale, same corner, and the track's own cells are attached
                at 0 gap, so the addon's 8px is not enough of a step to
                separate them.

                20px, NOT the chin divider's 16px: the track carries its own
                cell divider 30px away at 16px (half the cell), and that one is
                `bg-current`/15% while this is `--border`/10%, so at equal
                height the OUTER break reads fainter than the inner
                subdivision. Height is the lever rather than the color —
                the hairline is one token (DESIGN.md §6). Still well inside the
                32px track and the 28px kbd, so it stays a divider; at 24px it
                starts reading as a border on the chip. Rides the group's own
                breakpoint so it never hangs alone. */}
            <Separator
              orientation="vertical"
              // Decorative. Base UI always renders role="separator", and this
              // one divides nothing a screen reader navigates: the grouping it
              // draws is already carried by the group's aria-label below.
              aria-hidden="true"
              className="h-5! max-sm:hidden"
            />
            <ToggleGroup
              multiple
              size="sm"
              variant="solid"
              aria-label="Search options"
              className="max-sm:hidden"
              value={[
                ...(official ? ["official"] : []),
                ...(searchDescriptions ? ["desc"] : []),
              ]}
              onValueChange={(vals: string[]) => {
                setParams({
                  official: vals.includes("official"),
                  searchDescriptions: vals.includes("desc"),
                });
              }}
            >
              {SCOPE_OPTIONS.map((option) => (
                <ScopeToggle
                  key={option.value}
                  option={option}
                  active={scopeActive[option.value]}
                  handle={scopeTooltip}
                />
              ))}
            </ToggleGroup>
            <Tooltip handle={scopeTooltip}>
              {({ payload }) => (
                // positionMethod="fixed" — the default `absolute` anchors the
                // popup in DOCUMENT space, and toggling a filter reflows the
                // list region under it. The Popular list and the results list
                // both lay out for one frame before <Activity> pulls Popular
                // out, which doubles the page height, and an open tooltip lands
                // that far down the page for a frame before snapping back.
                // Viewport coordinates are immune to it, and they suit a
                // trigger inside a sticky container anyway.
                <TooltipContent variant="chrome" positionMethod="fixed">
                  {payload}
                </TooltipContent>
              )}
            </Tooltip>
          </>
        )}
        {/* Repo mode's submit lives inline in the field (URL-bar pattern) —
            the one-field form doesn't need a second row for it. Standard sm
            (32px) control, same as the toggles it replaces: a real click
            target that still sits inside the 44px field. No entrance fade:
            everything the repo morph brings in arrives at once. */}
        {isRepo && (
          <InputGroupButton
            variant="primary"
            size="sm"
            className="shrink-0"
            onClick={handleRepoSubmit}
            disabled={!repoDraft.trim()}
            leadingIcon={
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
    <div className="sticky top-[4.5rem] z-30 -mx-4 px-4 py-3 sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
      {/* Flat in both themes, near-black in dark only. `shadow-none` drops the
          inset Card's `--surface-shadow-combined-1`, whose ring layer is the
          1px edge this used to read as in light; the frame separates on tone
          alone now. `dark:bg-chrome` deliberately carries NO
          `data-surface="chrome"` — DESIGN.md §2 covers why, but the short
          version is that the attribute would aim `--input` at `--chrome-hover`
          and dissolve the search field into a 10% wash. */}
      <Card
        variant="inset"
        className="p-1 pb-0 shadow-none dark:bg-chrome dark:[--popup-surface:var(--chrome)]"
      >
        {/* Inner surface — the search instrument. The InputGroup owns
            the input behavior + focus ring; its chrome matches the
            inset Card's inner panel (borderless — elevation shadow +
            rim instead of a 1px line), and --popup-surface is set so
            elevated components nested inside composite against the
            right substrate. */}
        {/* The Autocomplete root is a context provider (no DOM); it wraps the
            input in BOTH modes so the input element never remounts on the
            morph (focus survives). Suggestions only exist in repo mode with a
            healthy GitHub connection — otherwise items is a stable empty list
            and no popup markup renders at all. */}
        <BaseAutocomplete.Root
          value={inputValue}
          onValueChange={handleValueChange}
          items={showRepoSuggestions ? repos : NO_REPOS}
          itemToStringValue={(repo: MyRepo) => repo.fullName}
          filter={contains}
          limit={SUGGESTION_LIMIT}
          openOnInputClick={showRepoSuggestions}
          onItemHighlighted={(repo) => {
            highlightedRepoRef.current = repo ?? null;
          }}
          onOpenChange={(open) => {
            suggestionsOpenRef.current = open;
          }}
        >
          <InputGroup
            ref={setSuggestionsAnchor}
            className="border-0 shadow-[var(--surface-shadow-3),var(--surface-rim-3)] [--popup-surface:var(--surface-3)]"
          >
            {searchField}
          </InputGroup>
          {showRepoSuggestions && (
            <AutocompletePortal>
              {/* Above the sticky composer's own z-30 so the list never
                  slides under the results it filters. */}
              <AutocompletePositioner
                className="z-40"
                align="start"
                anchor={suggestionsAnchor ?? undefined}
              >
                <AutocompletePopup>
                  {/* An unlisted value is still valid input — say so instead
                      of a dead "no results". */}
                  <AutocompleteEmpty>
                    Not one of your repos — Analyze reads any public repo URL.
                  </AutocompleteEmpty>
                  <AutocompleteList className="max-h-72">
                    <AutocompleteCollection>
                      {(repo: MyRepo) => (
                        <AutocompleteItem
                          key={repo.fullName}
                          value={repo}
                          onClick={() => selectRepo(repo)}
                        >
                          <span className="min-w-0 truncate">
                            {repo.fullName}
                          </span>
                          {repo.private && (
                            <>
                              <HugeiconsIcon
                                icon={SquareLock02Icon}
                                strokeWidth={2}
                                className="ml-1.5 size-3.5 shrink-0 text-muted-foreground"
                                aria-hidden="true"
                              />
                              {/* Screen readers skip aria-label on a bare
                                  svg; real (hidden) text always announces. */}
                              <span className="sr-only">private</span>
                            </>
                          )}
                          {repo.language && (
                            <span className="ml-auto shrink-0 pl-3 text-xs text-muted-foreground">
                              {repo.language}
                            </span>
                          )}
                        </AutocompleteItem>
                      )}
                    </AutocompleteCollection>
                  </AutocompleteList>
                  <AutocompleteStatus className="text-xs">
                    {hiddenCount > 0
                      ? `${hiddenCount} more — keep typing to narrow`
                      : null}
                  </AutocompleteStatus>
                </AutocompletePopup>
              </AutocompletePositioner>
            </AutocompletePortal>
          )}
        </BaseAutocomplete.Root>

        {/* Chin: filters left, leaderboards entry right. On mobile the
            filters collapse to one trigger → bottom sheet (sort lives
            inside the sheet there, since the chin hides it). */}
        {/* px-3 sets the chin on the same 12px line; its edge controls
            are all ghost, so each pulls its glyph/text onto the line
            with a negative margin (the addon idiom). */}
        {/* The chin persists in BOTH modes — the card's two-layer
            silhouette is its identity. Repo mode swaps its contents:
            back to search (navigation belongs at chin level, like the
            Hot + Trending link) plus a helper line explaining what
            Analyze reads. Same height either way, so the card never
            jumps on the morph. */}
        {/* flex-wrap here (and nowhere inside): at tight widths the whole
            right pair drops to its own row instead of the filters wrapping
            internally while the right pair floats between their lines. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-1">
          {isRepo ? (
            <RepoChin repoInputInvalid={repoInputInvalid} />
          ) : (
            <SearchChin onEnterRepoMode={enterRepoMode} />
          )}
        </div>
      </Card>
    </div>
  );
}

/**
 * Repo mode's chin: the helper/validation line plus the way back to search.
 * Reads explorer state itself — the composer only lends it the one piece of
 * local state it owns (the validation flag).
 */
function RepoChin({ repoInputInvalid }: { repoInputInvalid: boolean }) {
  const { setParams } = useExplorerState();
  return (
    <>
      {/* Helper slot doubles as the validation slot: an invalid Analyze
          attempt swaps the hint for an error with a format example
          (role=alert announces it). The error shows on mobile too — it's
          actionable, unlike the ambient hint. */}
      {repoInputInvalid ? (
        <p role="alert" className="min-w-0 text-xs text-destructive">
          Enter a GitHub repo URL, like github.com/vercel/next.js
        </p>
      ) : (
        <p className="text-xs text-muted-foreground max-sm:hidden">
          Reads languages and packages from public repos
        </p>
      )}
      {/* Same corner as "Match repo" in search mode — the mode switch lives in
          one stable spot. ms-auto keeps it pinned right on mobile, where the
          helper text is hidden. */}
      <Button
        variant="ghost"
        size="sm"
        className="ms-auto -me-2 shrink-0 text-muted-foreground"
        onClick={() => setParams({ mode: "text" })}
        leadingIcon={
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
  );
}

/**
 * Search mode's chin: the filter cluster (desktop), the sort + navigation
 * corner, and the mobile Sort & filter drawer. Reads explorer state itself;
 * entering repo mode stays with the composer (it touches the shared input).
 */
function SearchChin({ onEnterRepoMode }: { onEnterRepoMode: () => void }) {
  const { filterCount, setParams, clearSheetFilters } = useExplorerState();
  return (
    <>
      <div className="hidden min-w-0 sm:flex sm:items-center sm:gap-1.5">
        <CatalogControlsBar />
      </div>
      {/* Mobile: the desktop filter cluster above is hidden, so its
          two homes here are the sheet (sort/filters/switches) and a
          chin-level Match repo. */}
      <div className="flex items-center gap-0.5 sm:hidden">
        <Drawer direction="bottom">
          <DrawerTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="-ms-2 text-muted-foreground"
                leadingIcon={
                  <HugeiconsIcon
                    icon={FilterHorizontalIcon}
                    strokeWidth={2}
                    className="size-3.5"
                  />
                }
                trailingIcon={
                  filterCount.sheet > 0 ? (
                    <FilterCountBadge count={filterCount.sheet} />
                  ) : null
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
                {filterCount.sheet > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-me-2 text-muted-foreground"
                    onClick={clearSheetFilters}
                    leadingIcon={
                      <HugeiconsIcon
                        icon={Cancel01Icon}
                        strokeWidth={2}
                        className="size-3.5"
                      />
                    }
                  >
                    Clear ({filterCount.sheet})
                  </Button>
                )}
              </div>
            </DrawerHeader>
            <DrawerBody>
              <CatalogControlsSheet />
            </DrawerBody>
          </DrawerContent>
        </Drawer>
      </div>
      {/* Right pair: leaderboards + repo matching — the chin's
          "go places" corner on every breakpoint. Match repo is
          outermost with a → : the arrows are the mode-switch
          grammar ("Match repo →" enters the flow, "← Search
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
        <SortSelect className="max-sm:hidden" />
        <Separator
          orientation="vertical"
          className="mx-1 h-4! max-[860px]:hidden"
        />
        {/* Below 860px (mobile AND the 640-860px band where the
            labels don't fit next to the filters) each action
            collapses to its icon_sm square — ONE responsive button
            per action, not a hidden/shown pair: the label span (and
            Match repo's arrow) hide, and the width overrides
            reproduce icon_sm's square (size-9, sm:size-8, no
            padding). Flame/GitHub are safe bare glyphs; both open
            surfaces that explain themselves. */}
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-muted-foreground max-[860px]:w-9 max-[860px]:justify-center max-[860px]:px-0 sm:max-[860px]:w-8"
          onClick={() => setParams({ view: "hot" })}
          aria-label="Hot/Trending leaderboards"
          leadingIcon={
            <HugeiconsIcon
              icon={FireIcon}
              strokeWidth={2}
              className="size-3.5 text-warning-foreground max-[860px]:size-4"
            />
          }
        >
          <span className="max-[860px]:hidden">Hot/Trending</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="-me-2 shrink-0 text-muted-foreground max-[860px]:-me-2.5 max-[860px]:w-9 max-[860px]:justify-center max-[860px]:px-0 sm:max-[860px]:w-8"
          onClick={onEnterRepoMode}
          aria-label="Match repo"
          leadingIcon={
            <HugeiconsIcon
              icon={GithubIcon}
              strokeWidth={2}
              className="size-3.5 max-[860px]:size-4"
            />
          }
          trailingIcon={
            <HugeiconsIcon
              icon={ArrowRight02Icon}
              strokeWidth={2}
              className="size-3.5 max-[860px]:hidden"
            />
          }
        >
          <span className="max-[860px]:hidden">Match repo</span>
        </Button>
      </div>
    </>
  );
}
