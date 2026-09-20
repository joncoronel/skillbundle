import "server-only";
import { SITE_URL } from "./site-url";
import { skillHref, sourceHref, ownerHref } from "./skill-urls";
import { sourceOwner } from "./seo";

/**
 * schema.org graphs for the catalog pages. Rendered by `components/json-ld.tsx`.
 *
 * `server-only` because `SITE_URL` is — see the note on that module for why an
 * accidental client import would silently resolve every `@id` here to
 * localhost.
 *
 * ── Absolute URLs, always ─────────────────────────────────────────────────
 *
 * Unlike `metadata.alternates.canonical`, nothing resolves a relative URL
 * inside a JSON-LD blob: `metadataBase` applies to Next's own metadata output
 * and this is an opaque script body. A relative `@id` is read as a literal
 * string and the node stops joining up with anything, so every URL below goes
 * through `SITE_URL`. Same requirement that app/robots.ts and app/sitemap.ts
 * carry, for the same reason.
 *
 * ── Why SoftwareSourceCode and not SoftwareApplication ────────────────────
 *
 * A skill is a Markdown file that an agent reads, installed by copying it into
 * a directory. `SoftwareApplication` wants an operating system, an application
 * category and ideally a price and rating — it describes something you run.
 * `SoftwareSourceCode` describes a body of code with a programming language, a
 * repository and an author, which is what this actually is. Picking the type
 * that fits means no invented properties, and invented properties are how a
 * graph gets ignored.
 *
 * `interactionStatistic` carries the install count. It is the only numeric
 * signal we have that is both per-skill and honest; schema.org has no
 * "installs" property, and `UserDownloads` is the closest defined
 * `interactionType`, so it is used rather than minted.
 */

type Tier = { name: string; path: string };

/**
 * A `BreadcrumbList` from root-relative paths.
 *
 * Deduped by resolved URL rather than by caller. Well-known sources are a bare
 * domain, so they have no repo tier between the owner page and the skill —
 * `ownerHref` and `sourceHref` both resolve to `/site/<domain>` — and claiming
 * a level that does not exist is the kind of thing a validator flags. Doing it
 * here means the rule holds even if either helper's shape changes, and callers
 * do not each have to know about the two source types.
 *
 * Google wants the trail to match the one on the page. It does: the visible
 * breadcrumbs on the skill layout and the two directory headers are built from
 * the same `lib/skill-urls.ts` helpers.
 */
export function breadcrumbLd(tiers: Tier[]) {
  const resolved = tiers
    .map((tier) => ({ name: tier.name, url: `${SITE_URL}${tier.path}` }))
    .filter((tier, i, all) => all.findIndex((t) => t.url === tier.url) === i);

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: resolved.map((tier, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: tier.name,
      item: tier.url,
    })),
  };
}

/** The trail down to one skill: home, owner, repo, skill. */
export function skillBreadcrumbLd(
  source: string,
  skillId: string,
  name: string,
) {
  return breadcrumbLd([
    { name: "Skills", path: "/" },
    { name: sourceOwner(source), path: ownerHref(sourceOwner(source)) },
    { name: source, path: sourceHref(source) },
    { name, path: skillHref(source, skillId) },
  ]);
}

/** One skill, as a `SoftwareSourceCode` node. */
export function skillLd({
  source,
  skillId,
  name,
  description,
  installs,
  updatedAt,
  externalUrl,
}: {
  source: string;
  skillId: string;
  name: string;
  description?: string;
  installs?: number;
  updatedAt?: number;
  externalUrl: string;
}) {
  const url = `${SITE_URL}${skillHref(source, skillId)}`;
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    "@id": url,
    url,
    name,
    // The raw frontmatter string, not the rewritten meta description. A meta
    // description is sales copy trimmed to 160 characters; this field is read
    // as a factual claim about the thing, so the skill's own words belong here
    // even though they are long and duplicated across directories.
    ...(description && { description }),
    // "Markdown" is literally true — a skill is a SKILL.md — and is what makes
    // the node self-consistent with the type above.
    programmingLanguage: "Markdown",
    codeRepository: externalUrl,
    author: { "@type": "Organization", name: sourceOwner(source) },
    ...(updatedAt && { dateModified: new Date(updatedAt).toISOString() }),
    ...(installs &&
      installs > 0 && {
        interactionStatistic: {
          "@type": "InteractionCounter",
          interactionType: "https://schema.org/UserDownloads",
          userInteractionCount: installs,
        },
      }),
    isPartOf: { "@type": "WebSite", "@id": `${SITE_URL}/#website` },
  };
}

/**
 * The site node, plus the search box a search engine may offer under a
 * branded result.
 *
 * `target` points at the home page's real `?q=` param — the one
 * `components/skill-explorer.tsx` reads through nuqs — so the URL a search
 * engine constructs is a URL the app actually answers. A `SearchAction` whose
 * target 404s is worse than none: it is a promise the site does not keep, and
 * it is not something anyone would notice from the page.
 */
export function siteLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: `${SITE_URL}/`,
        name: "SkillBundle",
        description:
          "A catalog of agent skills for Claude Code, Cursor, and Codex, with change monitoring for the ones you install.",
        publisher: { "@id": `${SITE_URL}/#org` },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${SITE_URL}/?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#org`,
        name: "SkillBundle",
        url: `${SITE_URL}/`,
        logo: `${SITE_URL}/icons/icon-512.png`,
      },
    ],
  };
}

/**
 * A directory page's contents, as an `ItemList`.
 *
 * Positions are 1-based and reflect the order the page renders, which is by
 * install count. That ordering is the page's editorial claim, so it is worth
 * stating rather than shipping an unordered bag.
 */
export function itemListLd(
  items: { name: string; url: string }[],
  listName: string,
) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: listName,
    numberOfItems: items.length,
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      url: item.url,
    })),
  };
}
