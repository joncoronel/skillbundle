import type { Metadata } from "next";
import { connection } from "next/server";
import { unstable_cache } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { HomeContent } from "./home-content";

// Rendered dynamically via `connection()` (in the component below) so the
// client search UI's params resolve on the server — the full page ships in the
// initial HTML, with no client-side Suspense flash. The initial leaderboards
// are still cached with `unstable_cache` (1h), so per-request renders don't hit
// Convex.

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
  { revalidate: 3600 },
);

const getInitialTrending = unstable_cache(
  () =>
    fetchQuery(api.leaderboards.listTrending, {
      paginationOpts: { numItems: 60, cursor: null },
    }),
  ["home-trending"],
  { revalidate: 3600 },
);

const getInitialHot = unstable_cache(
  () => fetchQuery(api.leaderboards.listHot, { limit: 30 }),
  ["home-hot"],
  { revalidate: 3600 },
);

export default async function Home() {
  await connection();

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
          <span className="text-primary">AI skill bundle</span>
        </h1>
        <p className="mt-6 max-w-lg text-muted-foreground sm:text-lg sm:leading-relaxed lg:max-w-xl">
          Discover, compare, and bundle skills for AI coding assistants like
          Cursor and Claude. Pick your stack, share with a link.
        </p>
      </section>
    </HomeContent>
  );
}
