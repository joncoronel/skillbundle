import type { Metadata } from "next";

import { Suspense } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { safeFetchQuery as fetchQuery } from "@/lib/dummy-data";
import { api } from "@/convex/_generated/api";
import { HomeContent } from "./home-content";
import { SkillExplorer } from "@/components/skill-explorer";
import { HomeFallback } from "./home-fallback";

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
  cacheTag("home-popular");
  return fetchQuery(api.skills.listPopularSkills, {
    paginationOpts: { numItems: 30, cursor: null },
  });
}

async function getInitialTrending() {
  "use cache";
  cacheLife("hours");
  cacheTag("home-trending");
  return fetchQuery(api.leaderboards.listTrending, {
    paginationOpts: { numItems: 60, cursor: null },
  });
}

async function getInitialHot() {
  "use cache";
  cacheLife("hours");
  cacheTag("home-hot");
  return fetchQuery(api.leaderboards.listHot, { limit: 30 });
}

export default async function Home() {
  // Start fetching all three in parallel without awaiting them here.
  // This passes the raw promises down so the page can render immediately.
  const popularPromise = getInitialPopularSkills();
  const trendingPromise = getInitialTrending();
  const hotPromise = getInitialHot();

  return (
    <Suspense
      fallback={
        <HomeFallback/>
      }
    >
       <SkillExplorer               
        initialPopularSkillsPromise={popularPromise}
        initialTrendingPromise={trendingPromise}
        initialHotPromise={hotPromise}
      />      
     
    </Suspense>
  );
}