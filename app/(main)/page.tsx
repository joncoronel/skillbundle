import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { HomeContent } from "./home-content";

const HOME_TITLE = "SkillStack — Build your AI skill stack";
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

// Each leaderboard is cached on its own so cache invalidation is per-tab.
// All three use cacheLife("hours") — Popular updates daily, Trending updates
// hourly via cron, and Hot updates every 30 min but doesn't need to feel
// minute-fresh on the home page (1h staleness is fine for a "what's hot"
// surface; the underlying delta is hour-over-hour anyway).
async function getInitialPopularSkills() {
  "use cache";
  cacheLife("hours");
  return fetchQuery(api.skills.listPopularSkills, {
    paginationOpts: { numItems: 30, cursor: null },
  });
}

async function getInitialTrending() {
  "use cache";
  cacheLife("hours");
  return fetchQuery(api.leaderboards.listTrending, {
    paginationOpts: { numItems: 60, cursor: null },
  });
}

async function getInitialHot() {
  "use cache";
  cacheLife("hours");
  return fetchQuery(api.leaderboards.listHot, { limit: 30 });
}

export default async function Home() {
  // Fire all three in parallel — they're independent.
  const [initialPopularSkills, initialTrending, initialHot] = await Promise.all(
    [getInitialPopularSkills(), getInitialTrending(), getInitialHot()],
  );

  return (
    <HomeContent
      initialPopularSkills={initialPopularSkills}
      initialTrending={initialTrending}
      initialHot={initialHot}
    >
      <section className="mx-auto max-w-5xl px-4 pt-24 pb-10">
        <h1 className="font-display text-5xl font-semibold tracking-tight leading-hero text-balance sm:text-6xl lg:text-7xl">
          Build your
          <br />
          <span className="text-primary">AI skill stack</span>
        </h1>
        <p className="mt-6 max-w-lg text-muted-foreground sm:text-lg sm:leading-relaxed lg:max-w-xl">
          Discover, compare, and bundle skills for AI coding assistants like
          Cursor and Claude. Pick your stack, share with a link.
        </p>
      </section>
    </HomeContent>
  );
}
