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
    // Defining openGraph here detaches the auto-injected image from the root
    // app/opengraph-image.tsx file, so point at it explicitly. (It also feeds
    // the Twitter card, which falls back to og:image.)
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "SkillBundle — discover, compare, and bundle AI coding skills",
      },
    ],
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

  // Compact, static hero band. The page's working surface (discover pane +
  // bundle rail) is the headline act; the hero just states the job and gets
  // out of the way. It never collapses or animates.
  const hero = (
    <section className="mx-auto max-w-6xl px-4 pt-12 pb-2 sm:pt-14">
      <h1 className="font-display text-3xl font-medium tracking-tight text-balance sm:text-4xl">
        Pick skills. <span className="text-primary">Ship one install command.</span>
      </h1>
      <p className="mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
        Search and compare skills for Cursor, Claude Code, and other coding
        agents. Bundle the ones you want and share the whole set with a link.
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
