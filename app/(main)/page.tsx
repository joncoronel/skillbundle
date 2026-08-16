import type { Metadata } from "next";

import { Suspense } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { HomeContent, HomeFallback } from "./home-content";
import {
  HOME_HOT_TAG,
  HOME_POPULAR_TAG,
  HOME_TRENDING_TAG,
} from "@/lib/cache-tags";

// The page is static. <HomeContent> reads search params via nuqs' Next
// adapter, which suspends during prerendering — the Suspense fallback below
// renders the identical default no-params state (hero + search shell + popular
// leaderboard) under ExplorerStaticProvider (defaults derived from the URL
// parsers), so the prerendered HTML is the full page and the route stays
// prefetchable. After hydration the live tree applies
// any actual URL params — and stays in sync with Next's client-side router, so
// a <Link> into `/?q=…` (or `/compare?skills=…`) updates the params reactively.
// The three leaderboards are cached with `'use cache'` and tagged via
// `cacheTag`; the Convex leaderboard crons revalidate those tags on each sync
// (see app/api/revalidate/route.ts), so the snapshots stay fresh without a
// per-request Convex hit — and the tabs render straight from this data with no
// live subscription, so there's no stale-then-live flash on the client. The
// `cacheLife` windows are a safety net for a missed cron ping.

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

async function getInitialTrending() {
  "use cache";
  cacheLife("hours");
  cacheTag(HOME_TRENDING_TAG);
  return fetchQuery(api.leaderboards.listTrending, {
    paginationOpts: { numItems: 60, cursor: null },
  });
}

async function getInitialHot() {
  "use cache";
  cacheLife("hours");
  cacheTag(HOME_HOT_TAG);
  return fetchQuery(api.leaderboards.listHot, { limit: 30 });
}

export default async function Home() {
  // Fire all three in parallel — they're independent.
  const [initialPopularSkills, initialTrending, initialHot] = await Promise.all(
    [getInitialPopularSkills(), getInitialTrending(), getInitialHot()],
  );

  return (
    // The width wrapper sits ABOVE the boundary rather than inside both
    // branches: it used to be duplicated in HomeContent and HomeFallback with a
    // comment asking future editors to keep them matched, which was forced only
    // while they were `<main>` elements — a landmark cannot straddle a Suspense
    // boundary from outside. Now that `(main)/layout.tsx` owns the landmark and
    // this is a plain box, one copy in the static shell does for both.
    <div className="mx-auto max-w-6xl px-4">
      <Suspense
        fallback={
          <HomeFallback
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
        />
      </Suspense>
    </div>
  );
}
