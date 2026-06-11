import type { Metadata } from "next";

import { Suspense } from "react";
import { unstable_cache } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { HomeContent } from "./home-content";
import { HomeFallback } from "./home-fallback";

// The page is static. <HomeContent> reads search params (nuqs), which
// suspends during prerendering — the Suspense fallback below renders the
// identical default no-params state (hero + search shell + popular
// leaderboard), so the prerendered HTML is the full page and the route stays
// prefetchable. After hydration the live tree applies any actual URL params.
// The three leaderboards are cached with `unstable_cache` and tagged; the
// Convex leaderboard crons revalidate those tags on each sync (see
// app/api/revalidate/route.ts), so the snapshots stay fresh without a
// per-request Convex hit — and the tabs render straight from this data with no
// live subscription, so there's no stale-then-live flash on the client. The
// `revalidate` windows are a safety net for a missed cron ping.

const HOME_TITLE = "SkillBundle — Build your AI skill bundle";
const HOME_DESCRIPTION =
  "Discover, compare, and bundle AI coding assistant skills for Cursor, Claude, and other agents. Pick your stack, share with a link.";

export const metadata: Metadata = {
  title: HOME_TITLE,
  description: HOME_DESCRIPTION,
  openGraph: {
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    type: "website",
  },
};

const getInitialPopularSkills = unstable_cache(
  () =>
    fetchQuery(api.skills.listPopularSkills, {
      paginationOpts: { numItems: 30, cursor: null },
    }),
  ["home-popular-skills"],
  { tags: ["home-popular"], revalidate: 86400 },
);

const getInitialTrending = unstable_cache(
  () =>
    fetchQuery(api.leaderboards.listTrending, {
      paginationOpts: { numItems: 60, cursor: null },
    }),
  ["home-trending"],
  { tags: ["home-trending"], revalidate: 3600 },
);

const getInitialHot = unstable_cache(
  () => fetchQuery(api.leaderboards.listHot, { limit: 30 }),
  ["home-hot"],
  { tags: ["home-hot"], revalidate: 3600 },
);

export default async function Home() {
  // Fire all three in parallel — they're independent.
  const [initialPopularSkills, initialTrending, initialHot] = await Promise.all(
    [getInitialPopularSkills(), getInitialTrending(), getInitialHot()],
  );

  const hero = (
    <section className="mx-auto max-w-5xl px-4 pt-24 pb-10">
      <h1 className="font-display text-5xl font-semibold tracking-tight leading-hero text-balance sm:text-6xl lg:text-7xl">
        Build your
        <br />
        <span className="text-primary">AI skill bundle</span>
      </h1>
      <p className="mt-6 max-w-lg text-muted-foreground sm:text-lg sm:leading-relaxed lg:max-w-xl">
        Discover, compare, and bundle skills for AI coding assistants like
        Cursor and Claude. Pick your stack, share with a link.
      </p>
    </section>
  );

  return (
    <Suspense
      fallback={
        <HomeFallback
          hero={hero}
          initialPopularSkills={initialPopularSkills}
          initialTrending={initialTrending}
          initialHot={initialHot}
        />
      }
    >
      <HomeContent
        initialPopularSkills={initialPopularSkills}
        initialTrending={initialTrending}
        initialHot={initialHot}
      >
        {hero}
      </HomeContent>
    </Suspense>
  );
}
