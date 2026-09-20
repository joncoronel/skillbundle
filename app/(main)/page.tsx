import type { Metadata } from "next";

import { Suspense } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { SkillExplorer } from "@/components/skill-explorer";
import { HomeFallback } from "./home-content";
import { HOME_POPULAR_TAG } from "@/lib/cache-tags";
import { SITE_OG_IMAGE } from "@/lib/og/theme";
import { JsonLd } from "@/components/json-ld";
import { siteLd } from "@/lib/structured-data";

// The page is static. <SkillExplorer> reads search params via nuqs' Next
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

// The `<title>` leads with what people type, not with the brand. Nobody
// searches "SkillBundle" yet, and the competing directories that DO rank for
// this category all put the category term first — "8,021+ AI Agent Skills for
// Claude Code, Codex & Cursor | Get Claude Skills", "Claude Skills Directory —
// Browse 23,600+ Claude Code Skills" (sampled Sep 2026). Naming the three
// agents matters more than it looks: "Claude Code", "Cursor" and "Codex" are
// the terms with volume, while "AI coding skills" — what this said before — is
// a phrase the ecosystem does not actually use.
//
// Deliberately NO install count in the title, unlike those competitors. It
// would be the strongest single addition (a number is what makes a directory
// look worth opening) but it has to be TRUE on a page that is statically
// prerendered and revalidated on a tag, so a stale figure would sit in the SERP
// for as long as the entry lives. Worth doing properly off the same
// `'use cache'` loader the popular list already uses; not worth hardcoding.
//
// This is the site's one shot at the head term. Every other page targets the
// long tail by construction, so if this title is wrong nothing else compensates.
const HOME_TITLE =
  "Agent Skills for Claude Code, Cursor and Codex | SkillBundle";
const HOME_DESCRIPTION =
  "Search, filter, and compare agent skills for Claude Code, Cursor, and Codex. Save the ones you use to a bundle and get told when they change.";

export const metadata: Metadata = {
  title: HOME_TITLE,
  description: HOME_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    type: "website",
    url: "/",
    // Defining openGraph here detaches the auto-injected image from the root
    // app/opengraph-image.tsx file, so point at it explicitly. (It also feeds
    // the Twitter card, which falls back to og:image.)
    images: [SITE_OG_IMAGE],
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
    // branches: it used to be duplicated in the page and HomeFallback with a
    // comment asking future editors to keep them matched, which was forced only
    // while they were `<main>` elements — a landmark cannot straddle a Suspense
    // boundary from outside. Now that `(main)/layout.tsx` owns the landmark and
    // this is a plain box, one copy in the static shell does for both.
    <div className="mx-auto max-w-6xl px-4">
      {/* The WebSite + Organization graph, on the home page only — both nodes
          are site-level, so repeating them per page would restate the same
          facts ~16k times. Skill pages reference the site node by `@id`
          instead (see lib/structured-data.ts). The SearchAction here is what
          can earn a sitelinks search box under a branded result. */}
      <JsonLd data={siteLd()} />
      <Suspense
        fallback={<HomeFallback initialPopularSkills={initialPopularSkills} />}
      >
        <SkillExplorer initialPopularSkills={initialPopularSkills} />
      </Suspense>
    </div>
  );
}
