"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon, GithubIcon } from "@hugeicons/core-free-icons";
import { Input } from "@/components/ui/cubby-ui/input";
import { Kbd } from "@/components/ui/cubby-ui/kbd";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsPanels,
  TabsContent,
} from "@/components/ui/cubby-ui/tabs";
import { Crossfade } from "@/components/ui/cubby-ui/crossfade";
import Hero from "@/components/hero/hero";

const noop = () => {};

export function HomeFallback() {
  return (
    <>
      <Hero />
      <main className="mx-auto max-w-6xl px-4 pt-6 pb-20">
        <Tabs value="text" onValueChange={noop}>
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

          <div className="flex gap-2">
            <div className="relative flex-1">
              <HugeiconsIcon
                icon={Search01Icon}
                strokeWidth={2}
                className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none"
              />
              <Input
                placeholder="Search skills by name…"
                value=""
                readOnly
                className="pl-9 pr-9"
              />
              <Kbd
                size="sm"
                variant="ghost"
                className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none max-sm:hidden"
                aria-hidden="true"
              >
                /
              </Kbd>
            </div>
          </div>

          <TabsPanels>
            <TabsContent value="text">
              <Crossfade active={false}>
                <div className="transition-opacity duration-200 ease-out-cubic motion-reduce:transition-none">
                  {/* Empty state while loading */}
                  <div className="h-40" />
                </div>
                <div className="transition-opacity duration-200 ease-out-cubic motion-reduce:transition-none">
                  {null}
                </div>
              </Crossfade>
            </TabsContent>
            <TabsContent value="repo">
              <div className="h-40" />
            </TabsContent>
          </TabsPanels>
        </Tabs>
      </main>
    </>
  );
}
