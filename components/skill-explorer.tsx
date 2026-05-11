"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryState } from "nuqs";
import type { FunctionReturnType } from "convex/server";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Search01Icon,
  Cancel01Icon,
  GithubIcon,
  FlashIcon,
} from "@hugeicons/core-free-icons";
import { DotMatrixRipple } from "@/components/ui/dot-matrix-ripple";
import {
  modeParser,
  searchQueryParser,
  repoUrlParser,
  type ModeValue,
} from "@/lib/search-params";
import { useDebouncedCachedSearch } from "@/hooks/use-debounced-cached-search";
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

interface SkillExplorerProps {
  canAutoDetect: boolean;
  initialPopularSkills: FunctionReturnType<typeof api.skills.listPopularSkills>;
  initialTrending: FunctionReturnType<typeof api.leaderboards.listTrending>;
  initialHot: FunctionReturnType<typeof api.leaderboards.listHot>;
}

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

  // Search machinery (debounce + cache bypass + spinner state) lives in the
  // shared hook. The data consumer is `<SkillSearchResults>`, not this
  // component, so we deliberately don't destructure `query.data` here —
  // that keeps Proxy tracking from re-rendering the parent on Convex
  // live updates of search results.
  const { effectiveQuery: effectiveTextQuery, isInputLoading: textIsLoading } =
    useDebouncedCachedSearch({
      rawQuery: textQuery,
      fn: api.skills.searchSkills,
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
  // Spinner only shows in text mode — the hook's `textIsLoading` covers
  // every "pending search work" state for the text input.
  const isInputLoading = isText && textIsLoading;
  const Icon = isText ? Search01Icon : GithubIcon;

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
            {isInputLoading ? (
              <span className="absolute left-3 top-1/2 -translate-y-1/2 size-4 flex items-center justify-center text-muted-foreground pointer-events-none">
                <DotMatrixRipple size="xs" ariaLabel="Searching" />
              </span>
            ) : (
              <HugeiconsIcon
                icon={Icon}
                strokeWidth={2}
                className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none"
              />
            )}
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
