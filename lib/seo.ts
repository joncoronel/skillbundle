/**
 * Search-facing title and description text for the catalog pages.
 *
 * ── The problem these solve ───────────────────────────────────────────────
 *
 * A skill's `skillId` is its slug in ONE repo, not a name anybody owns. The
 * catalog therefore carries the same slug many times over: measured off the
 * production sitemap on 2026-09-19, `skill-creator` appears 56 times,
 * `code-review` 30, `frontend-design` 25, `agent-browser` 23. Those are
 * separate repos publishing their own take, so they are legitimately separate
 * pages — `listSitemapEntries` already drops the byte-identical ones via
 * `isDuplicate`, and what survives is near-duplicates, which exact hashing
 * cannot see but Google's clustering can.
 *
 * Titled `${name} | SkillBundle` they were indistinguishable: 56 pages, one
 * title, and two of the five sampled `skill-creator` pages had byte-identical
 * meta descriptions as well (both are Anthropic repos publishing the same
 * file).
 *
 * The publisher is the disambiguator, because it is the thing that actually
 * differs and the thing a searcher would use to tell two of them apart.
 *
 * ── Be honest about what this is and is not fixing ────────────────────────
 *
 * Search Console, 19 Sep 2026: "Duplicate without user-selected canonical" is
 * **2 pages**, not thousands. So collapsing titles is NOT what is keeping the
 * catalog out of the index — 13,556 URLs sit at "Discovered - currently not
 * indexed", which is Google declining to crawl them at all, and app/robots.ts
 * carries the crawl-budget finding that actually explains that number.
 *
 * What this file fixes is the layer above: 812 pages earn impressions at an
 * average position of 33 and a 0.4% click-through. A page at position 33 with
 * a title that does not contain the query has no route to a click even if it
 * is indexed perfectly. Treat this as relevance and click-through work, which
 * is worth doing and is cheap, and not as the indexing fix. If the indexed
 * count moves after this ships, that is the robots.txt change, not this.
 *
 * ── Why the description is rewritten rather than passed through ───────────
 *
 * A skill's `description` is frontmatter copied verbatim out of its SKILL.md.
 * The same string is therefore already on GitHub, on skills.sh, and on every
 * other directory that syncs the same feed, so shipping it alone contributes
 * nothing a search engine has not seen. It is also written for an AGENT to
 * match against, not for a human to read in a result: the sampled ones run
 * 300-450 characters and open with "Use this skill whenever…", where Google
 * shows ~160 and cuts mid-sentence.
 *
 * So the description keeps the skill's own words (they are the accurate part)
 * but leads with the facts that are ours and are per-page: who published it and
 * how many installs it has. `installs` moves daily, which is a feature here —
 * it is the one component that distinguishes two pages whose SKILL.md text is
 * identical.
 *
 * Nothing in this file affects ranking directly; titles do, descriptions only
 * affect click-through. Both are here because they share the truncation rule.
 */

/** GitHub sources are "owner/repo"; well-known sources are a bare domain. */
export function sourceOwner(source: string): string {
  return source.split("/")[0];
}

/**
 * Cut to `max` characters on a word boundary, with an ellipsis.
 *
 * Distinct from `truncate` in lib/og/templates.tsx, which cuts mid-word on
 * purpose: that one feeds a fixed-width image where the exact character count
 * is what has to be bounded. Here the string is read as prose, so a half-word
 * is worse than a shorter line. Not shared for that reason.
 */
export function truncateWords(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  // A single token longer than `max` has no space to break on; cut it anyway
  // rather than returning the whole thing and blowing the budget.
  return (
    (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…"
  );
}

/**
 * Google renders titles to a pixel width, not a character count, and truncates
 * around 600px. 60 characters is the usual proxy for that in a proportional
 * face. Nothing enforces it — a long slug plus a long owner can exceed it, and
 * that is accepted: the distinguishing part (name, then owner) is at the front,
 * so what gets cut is the brand suffix, which is the right thing to lose.
 */
const TITLE_BUDGET = 60;
const BRAND = " | SkillBundle";

/** Meta descriptions are shown to ~160 characters. */
const DESCRIPTION_BUDGET = 160;

/**
 * A skill Overview's `<title>`.
 *
 * "skill by <owner>" rather than a bare "<owner>" because the word carries the
 * query term: people search "pdf skill claude code", not "pdf anthropics". The
 * brand suffix is dropped when the informative part has already spent the
 * budget — a truncated "| SkillBu…" is worth less than the owner it displaced.
 */
export function skillPageTitle(name: string, source: string): string {
  const head = `${name} skill by ${sourceOwner(source)}`;
  return head.length + BRAND.length <= TITLE_BUDGET ? `${head}${BRAND}` : head;
}

/** A skill tab's `<title>`. Same disambiguation, with the tab as the subject. */
export function skillTabTitle(
  name: string,
  source: string,
  tabLabel: string,
): string {
  const head = `${name} ${tabLabel} (${sourceOwner(source)})`;
  return head.length + BRAND.length <= TITLE_BUDGET ? `${head}${BRAND}` : head;
}

/**
 * A skill Overview's meta description.
 *
 * The lead sentence is per-page by construction (owner and install count), so
 * two pages sharing a SKILL.md still differ here. `installs` is omitted rather
 * than printed as 0 when it is missing or zero: a GitHub-only skill has no
 * upstream count at all (see `isGitHubOnly` in convex/schema.ts) and "0
 * installs" reads as a dead skill rather than an unmeasured one.
 */
export function skillPageDescription(
  name: string,
  source: string,
  installs: number | undefined,
  description: string | undefined,
): string {
  const lead =
    installs && installs > 0
      ? `${name} is an agent skill from ${sourceOwner(source)} with ${installs.toLocaleString("en-US")} install${installs === 1 ? "" : "s"}.`
      : `${name} is an agent skill from ${sourceOwner(source)}.`;
  if (!description) {
    return truncateWords(
      `${lead} Install it with npx skills add, and watch it for changes on SkillBundle.`,
      DESCRIPTION_BUDGET,
    );
  }
  return truncateWords(`${lead} ${description}`, DESCRIPTION_BUDGET);
}
