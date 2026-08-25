import type { Metadata } from "next";

import { Suspense } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { HomeContent, HomeFallback } from "./home-content";
import { HOME_POPULAR_TAG } from "@/lib/cache-tags";

// The page is static. <HomeContent> reads search params via nuqs' Next
// adapter, which suspends during prerendering — the Suspense fallback below
// renders the identical default no-params state (hero + search shell + popular
// leaderboard) under ExplorerStaticProvider (defaults derived from the URL
// parsers), so the prerendered HTML is the full page and the route stays
// prefetchable. After hydration the live tree applies
// any actual URL params — and stays in sync with Next's client-side router, so
// a <Link> into `/?q=…` (or `/compare?skills=…`) updates the params reactively.
// The popular leaderboard is cached with `'use cache'` and tagged via
// `cacheTag`; the Convex sync cron revalidates that tag (see
// app/api/revalidate/route.ts), so the snapshot stays fresh without a
// per-request Convex hit. The `cacheLife` window is a safety net for a missed
// cron ping.
//
// Hot and Trending are NOT fetched here. They render only inside the
// leaderboard sheet, which starts closed, so prefetching them put 90 skill
// rows into every visitor's payload for a surface most never open. The sheet
// fetches the tab it is showing; see `useLeaderboard` in
// components/leaderboard-sheet.tsx.

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

async function getInitialPopularSkills() {
  "use cache";
  cacheLife("days");
  cacheTag(HOME_POPULAR_TAG);
  return fetchQuery(api.skills.listPopularSkills, {
    paginationOpts: { numItems: 30, cursor: null },
  });
}

export default async function Home() {
  const initialPopularSkills = await getInitialPopularSkills();

  return (
    // The width wrapper sits ABOVE the boundary rather than inside both
    // branches: it used to be duplicated in HomeContent and HomeFallback with a
    // comment asking future editors to keep them matched, which was forced only
    // while they were `<main>` elements — a landmark cannot straddle a Suspense
    // boundary from outside. Now that `(main)/layout.tsx` owns the landmark and
    // this is a plain box, one copy in the static shell does for both.
    <div className="mx-auto max-w-6xl px-4">
      <Suspense
        fallback={<HomeFallback initialPopularSkills={initialPopularSkills} />}
      >
        <HomeContent initialPopularSkills={initialPopularSkills} />
      </Suspense>
    </div>
  );
}
