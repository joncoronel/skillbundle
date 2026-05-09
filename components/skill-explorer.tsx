"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useQuery,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useQueryState } from "nuqs";
import type { FunctionReturnType } from "convex/server";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Search01Icon,
  Cancel01Icon,
  GithubIcon,
  FlashIcon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import {
  modeParser,
  searchQueryParser,
  repoUrlParser,
  type ModeValue,
} from "@/lib/search-params";
import { Input } from "@/components/ui/cubby-ui/input";
import { Kbd } from "@/components/ui/cubby-ui/kbd";
import { Button } from "@/components/ui/cubby-ui/button";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsPanels,
  TabsContent,
} from "@/components/ui/cubby-ui/tabs";
import { SkillSearchResults } from "@/components/skill-search";
import { DefaultSkillsList } from "@/components/default-skills-list";
import { RepoAnalysisResults } from "@/components/repo-url-input";
import { BundleBar } from "@/components/bundle-bar";
import {
  SkillDetailSheet,
  createSkillDetailHandle,
} from "@/components/skill-detail-sheet";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

interface SkillExplorerProps {
  canAutoDetect: boolean;
  initialPopularSkills: FunctionReturnType<typeof api.skills.listPopularSkills>;
  initialTrending: FunctionReturnType<typeof api.leaderboards.listTrending>;
  initialHot: FunctionReturnType<typeof api.leaderboards.listHot>;
}

const TEXT_DEBOUNCE_MS = 200;

const skillDetailHandle = createSkillDetailHandle();

export function SkillExplorer({
  canAutoDetect,
  initialPopularSkills,
  initialTrending,
  initialHot,
}: SkillExplorerProps) {
  const [mode, setMode] = useQueryState("mode", modeParser);
  const [textQuery, setTextQuery] = useQueryState("q", searchQueryParser);
  const [repoUrl, setRepoUrl] = useQueryState("repo", repoUrlParser);

  // Debounce the search query so results don't re-fetch on every keystroke.
  // The empty-input case is reset synchronously at render time — without that,
  // a fast retype after clearing would see the previous query's value leak
  // through and break the fresh-search-after-clear skeleton heuristic in
  // SkillSearchResults.
  const trimmedTextQuery = textQuery.trim();
  const [debouncedText, setDebouncedText] = useState(trimmedTextQuery);
  if (!trimmedTextQuery && debouncedText) {
    setDebouncedText("");
  }
  useEffect(() => {
    if (!trimmedTextQuery) return;
    const timer = setTimeout(
      () => setDebouncedText(trimmedTextQuery),
      TEXT_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [trimmedTextQuery]);

  // If the trimmed query already has cached data in TanStack Query's cache,
  // bypass the 300ms debounce and use it directly — the inner useQuery in
  // SkillSearchResults hits the cache synchronously and renders results
  // without waiting. Falls back to the debounced value for queries that
  // haven't been searched yet (so the backend isn't pinged on every keystroke).
  const queryClient = useQueryClient();
  const cachedSkillsKey = trimmedTextQuery
    ? convexQuery(api.skills.searchSkills, { query: trimmedTextQuery })
        .queryKey
    : null;
  const isCachedSkills = cachedSkillsKey
    ? queryClient.getQueryData(cachedSkillsKey) !== undefined
    : false;

  const effectiveTextQuery = trimmedTextQuery
    ? isCachedSkills
      ? trimmedTextQuery
      : debouncedText
    : "";

  // Subscribe to the same useQuery here (TanStack dedupes; the real consumer
  // lives in SkillSearchResults) so we can drive the input-spinner state from
  // the parent. Skipped when the trimmed query is already in cache — instant
  // results don't need a loading indicator.
  const { isFetching, isPlaceholderData } = useQuery({
    ...convexQuery(
      api.skills.searchSkills,
      effectiveTextQuery ? { query: effectiveTextQuery } : "skip",
    ),
    placeholderData: keepPreviousData,
    gcTime: 5 * 60_000,
  });

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
    const trimmed = repoInput.trim();
    if (!trimmed) return;
    setRepoUrl(trimmed);
  }

  const handleModeChange = useCallback(
    (value: string) => setMode(value as ModeValue),
    [setMode],
  );

  const isText = mode === "text";
  const inputValue = isText ? textQuery : repoInput;
  const placeholder = isText
    ? "Search skills by name…"
    : "https://github.com/owner/repo";
  // Spinner is "any pending search work for the current input": debounce
  // hasn't caught up, fetch is in flight, or we're showing placeholder data
  // for a previous query. Skipped when cached (results are already showing,
  // no need for a loading indicator).
  const isInputLoading =
    isText &&
    trimmedTextQuery.length > 0 &&
    !isCachedSkills &&
    (trimmedTextQuery !== effectiveTextQuery ||
      isFetching ||
      isPlaceholderData);
  const Icon = isText
    ? isInputLoading
      ? Loading03Icon
      : Search01Icon
    : GithubIcon;

  return (
    <>
      <Tabs value={mode} onValueChange={handleModeChange}>
        <TabsList variant="underline" className="mb-3">
          <TabsTrigger value="text">
            <HugeiconsIcon
              icon={Search01Icon}
              strokeWidth={2}
              className="size-3.5"
            />
            Search
          </TabsTrigger>
          <TabsTrigger value="repo">
            <HugeiconsIcon
              icon={GithubIcon}
              strokeWidth={2}
              className="size-3.5"
            />
            Repo
          </TabsTrigger>
        </TabsList>

        {/* Unified input — lives inside Tabs root but outside TabsPanels so
            it doesn't animate on mode change. State (mode) drives which
            input/placeholder/icon renders. */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <HugeiconsIcon
              icon={Icon}
              strokeWidth={2}
              className={cn(
                "absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none",
                isInputLoading && "animate-spin motion-reduce:animate-none",
              )}
              aria-label={isInputLoading ? "Searching" : undefined}
            />
            <Input
              ref={inputRef}
              placeholder={placeholder}
              value={inputValue}
              onChange={(e) => {
                if (isText) {
                  setTextQuery(e.target.value);
                  // Reset debounced value when clearing so the next keystroke
                  // doesn't briefly resurface stale results.
                } else {
                  setRepoInput(e.target.value);
                }
              }}
              onKeyDown={(e) => {
                if (!isText && e.key === "Enter") handleRepoSubmit();
              }}
              className="pl-9 pr-9"
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
                  if (isText) {
                    setTextQuery("");
                  } else {
                    setRepoInput("");
                    setRepoUrl("");
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
          {!isText && (
            <Button
              variant="outline"
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
            </Button>
          )}
        </div>

        {/* Results region — each panel keeps mounted so per-mode state
            (search results, repo analysis) survives mode switches. */}
        <TabsPanels>
          <TabsContent value="text">
            {/* Both lists stay mounted: the default list preserves scroll +
                pagination state across type-and-clear, and the search list
                preserves its 60+ rows (each with jotai subscriptions) across
                browse ↔ search toggles. `hidden` maps to display:none, which
                also makes the default list's IntersectionObserver sentinel
                non-intersecting while the user is searching. The search list
                tracks "did the user clear in between" via a lastSettledQuery
                state so the skeleton still fires for fresh-search-after-clear
                without paying remount cost on every toggle. */}
            <div hidden={!!effectiveTextQuery}>
              <DefaultSkillsList
                initialPage={initialPopularSkills}
                initialTrending={initialTrending}
                initialHot={initialHot}
                sheetHandle={skillDetailHandle}
              />
            </div>
            <div hidden={!effectiveTextQuery}>
              <SkillSearchResults
                query={effectiveTextQuery}
                sheetHandle={skillDetailHandle}
              />
            </div>
          </TabsContent>
          <TabsContent value="repo">
            <RepoAnalysisResults
              repoUrl={repoUrl}
              canAutoDetect={canAutoDetect}
              sheetHandle={skillDetailHandle}
            />
          </TabsContent>
        </TabsPanels>
      </Tabs>

      <BundleBar />
      <SkillDetailSheet handle={skillDetailHandle} />
    </>
  );
}
