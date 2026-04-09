"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryState } from "nuqs";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Search01Icon,
  Cancel01Icon,
  GithubIcon,
  FlashIcon,
} from "@hugeicons/core-free-icons";
import {
  modeParser,
  searchQueryParser,
  repoUrlParser,
  type ModeValue,
} from "@/lib/search-params";
import { BundleSelectionProvider } from "@/lib/bundle-selection-context";
import { Input } from "@/components/ui/cubby-ui/input";
import { Button } from "@/components/ui/cubby-ui/button";
import { SkillSearchResults } from "@/components/skill-search";
import { RepoAnalysisResults } from "@/components/repo-url-input";
import { BundleBar } from "@/components/bundle-bar";
import { cn } from "@/lib/utils";

interface SkillExplorerProps {
  canAutoDetect: boolean;
}

const TEXT_DEBOUNCE_MS = 300;

export function SkillExplorer({ canAutoDetect }: SkillExplorerProps) {
  const [mode, setMode] = useQueryState("mode", modeParser);
  const [textQuery, setTextQuery] = useQueryState("q", searchQueryParser);
  const [repoUrl, setRepoUrl] = useQueryState("repo", repoUrlParser);

  const [debouncedText, setDebouncedText] = useState(textQuery.trim());
  const [repoTriggerKey, setRepoTriggerKey] = useState(repoUrl ? 1 : 0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce text query (300ms)
  useEffect(() => {
    const trimmed = textQuery.trim();
    const id = setTimeout(() => setDebouncedText(trimmed), TEXT_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [textQuery]);

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

  function handleModeChange(next: ModeValue) {
    setMode(next);
    // Re-focus the input so the user can keep typing immediately
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleRepoSubmit() {
    const trimmed = repoUrl.trim();
    if (!trimmed) return;
    setRepoTriggerKey((k) => k + 1);
  }

  const isText = mode === "text";
  const inputValue = isText ? textQuery : repoUrl;
  const placeholder = isText
    ? "Search skills by name…"
    : "https://github.com/owner/repo";
  const Icon = isText ? Search01Icon : GithubIcon;

  return (
    <BundleSelectionProvider>
      <div>
        {/* Mode toggle */}
        <div className="mb-3 flex items-center gap-1 rounded-full border bg-muted/30 p-0.5 w-fit">
          <button
            type="button"
            onClick={() => handleModeChange("text")}
            className={cn(
              "px-3 py-1 text-xs font-medium rounded-full transition-colors",
              isText
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="inline-flex items-center gap-1.5">
              <HugeiconsIcon
                icon={Search01Icon}
                strokeWidth={2}
                className="size-3.5"
              />
              Text
            </span>
          </button>
          <button
            type="button"
            onClick={() => handleModeChange("repo")}
            className={cn(
              "px-3 py-1 text-xs font-medium rounded-full transition-colors",
              !isText
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="inline-flex items-center gap-1.5">
              <HugeiconsIcon
                icon={GithubIcon}
                strokeWidth={2}
                className="size-3.5"
              />
              Repo
            </span>
          </button>
        </div>

        {/* Unified input */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <HugeiconsIcon
              icon={Icon}
              strokeWidth={2}
              className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none"
            />
            <Input
              ref={inputRef}
              placeholder={placeholder}
              value={inputValue}
              onChange={(e) => {
                if (isText) setTextQuery(e.target.value);
                else setRepoUrl(e.target.value);
              }}
              onKeyDown={(e) => {
                if (!isText && e.key === "Enter") handleRepoSubmit();
              }}
              className="pl-9 pr-9"
            />
            {inputValue && (
              <button
                type="button"
                onClick={() => {
                  if (isText) setTextQuery("");
                  else setRepoUrl("");
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
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
              disabled={!repoUrl.trim() || !canAutoDetect}
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

        {/* Results region — swaps based on mode, each mode keeps its own state */}
        <div hidden={!isText}>
          <SkillSearchResults query={debouncedText} />
        </div>
        <div hidden={isText}>
          <RepoAnalysisResults
            repoUrl={repoUrl}
            triggerKey={repoTriggerKey}
            canAutoDetect={canAutoDetect}
          />
        </div>
      </div>

      <BundleBar />
    </BundleSelectionProvider>
  );
}
