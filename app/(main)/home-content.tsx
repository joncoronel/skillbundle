"use client";

import { useQueryState } from "nuqs";
import { cn } from "@/lib/utils";
import {
  modeParser,
  searchQueryParser,
  repoUrlParser,
} from "@/lib/search-params";
import { SkillExplorer } from "@/components/skill-explorer";
// import useMeasure from "react-use-measure";
import { useCollapsibleHeight } from "@/hooks/cubby-ui/use-collapsible-height";
import { useUserPlan } from "@/hooks/use-user-plan";

export function HomeContent() {
  const { limits } = useUserPlan();
  const [mode] = useQueryState("mode", modeParser);
  const [query] = useQueryState("q", searchQueryParser);
  const [repoUrl] = useQueryState("repo", repoUrlParser);
  const searchActive =
    mode === "text"
      ? query.trim().length > 0
      : repoUrl.trim().length > 0;
  const { ref, height } = useCollapsibleHeight();

  return (
    <>
      {/* Hero */}
      <div
        className={cn(
          "max-sm:duration-0 max-sm:transition-none transition-[height,opacity] duration-200 ease-out-cubic overflow-hidden",
          searchActive ? "opacity-0" : `opacity-100`,
        )}
        style={{ height: searchActive ? 0 : height }}
      >
        <div ref={ref} className={cn("max-sm:duration-0 ")}>
          <section className="mx-auto max-w-5xl px-4 pt-16 pb-10 text-center">
            <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
              Build your{" "}
              <mark className="bg-primary/10 text-primary rounded px-1">
                AI skill stack
              </mark>
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
              Discover, compare, and bundle skills for AI coding assistants like
              Cursor and Claude. Pick your technologies, find the best skills,
              and share your stack.
            </p>
          </section>
        </div>
      </div>

      {/* Main content */}
      <main
        className={cn(
          "mx-auto max-w-5xl px-4 pb-20 transition-[padding-top] duration-200 max-sm:duration-0 ease-out-cubic",
          searchActive ? "pt-6" : "pt-0",
        )}
      >
        <SkillExplorer canAutoDetect={limits?.canAutoDetect ?? true} />
      </main>
    </>
  );
}
