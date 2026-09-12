import "server-only";
import { cacheLife } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { formatInstalls } from "@/lib/utils";
import { buildSkillInstallCommand } from "@/lib/install-commands";
import { og } from "./theme";
import { FONT } from "./fonts";
import {
  BrandHero,
  CommandRow,
  Frame,
  Lede,
  MetaLine,
  StatStrip,
  Title,
  WordHero,
  renderOg,
  OG_CACHE,
  truncate,
} from "./templates";

/**
 * High-level OG image builders, one per surface. Data-backed builders fetch
 * through `'use cache'` loaders so the underlying `fetchQuery` (which forces
 * `no-store`) is cached rather than re-hitting Convex on every crawl. The
 * rendered PNG itself is cached at the CDN via the Cache-Control header in
 * `renderOg` (lib/og/templates.tsx) — that's what keeps images from
 * regenerating on every link, independent of these data loaders.
 *
 * The skill card is the exception and the cheapest surface here BECAUSE it is:
 * it reads nothing, so its PNG is not pinned to the lifetime of any row and
 * caches for a year rather than a day. It is also by far the most requested,
 * at ~16k URLs. See `skillOgImage` for what that cost and why.
 *
 * Identity rule: one family, with the display end built from weight and
 * tracking. Section words, the wordmark and every figure are set at 700 and
 * tracked hard so the card reads at a glance; variable-length names and prose
 * stay at body weight and normal tracking.
 */

// ── Cached loaders ──────────────────────────────────────────────────────────

// The loaders below are local: each is specific to one OG surface, and none has
// a second consumer to share with. The skill card has none at all any more — it
// draws from the URL, which is what buys it OG_CACHE.YEAR. See skillOgImage.

// Keyed by (urlId, version): `version` is the bundle's updatedAt, passed only
// so it becomes part of the cache key (`'use cache'` keys on the args). A new
// version → a fresh entry → the next render reflects the edit; an unchanged
// version is served from cache. The 1-day cacheLife is a backstop for install
// counts that drift via the daily sync without bumping updatedAt. Public
// bundles only (no auth token) — private ones return null → brand fallback.
async function loadBundle(urlId: string, version: string) {
  "use cache";
  cacheLife("days");
  void version;
  return fetchQuery(api.bundles.getByUrlId, { urlId });
}

async function loadSourceCounts(source: string) {
  "use cache";
  cacheLife("days");
  const skills = await fetchQuery(api.skills.listBySource, { source });
  const visible = skills.filter((s) => !s.isDelisted);
  return {
    count: visible.length,
    totalInstalls: visible.reduce((sum, s) => sum + s.installs, 0),
  };
}

async function loadOrg(org: string) {
  "use cache";
  cacheLife("days");
  return fetchQuery(api.skills.listRepoAggregatesByOrg, { org });
}

// ── Shared bits ───────────────────────────────────────────────────────────

/** Size an entity name so a single line stays inside the frame. */
function nameSize(text: string): number {
  if (text.length <= 20) return 62;
  if (text.length <= 32) return 52;
  if (text.length <= 44) return 44;
  return 38;
}

// ── Builders ────────────────────────────────────────────────────────────────

/** The brand / site-wide default card: logo + wordmark at hero scale. */
export function brandOgImage() {
  return renderOg(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        background: og.bg,
        color: og.fg,
        fontFamily: FONT.sans,
        padding: 88,
      }}
    >
      <BrandHero />
      <div
        style={{
          display: "flex",
          marginTop: 40,
          fontSize: 52,
          fontWeight: 700,
          letterSpacing: "-0.03em",
          lineHeight: 1.08,
          color: og.fg,
          maxWidth: 940,
        }}
      >
        Skills for your AI coding stack.
      </div>
      <div
        style={{
          display: "flex",
          marginTop: 22,
          fontSize: 27,
          lineHeight: 1.4,
          color: og.muted,
          maxWidth: 900,
        }}
      >
        Discover, compare, and bundle skills for Cursor, Claude Code, and other
        agents. Share a curated set with one install command.
      </div>
    </div>,
  );
}

/**
 * Generic section card: a short word at hero scale, plus a subtitle. For
 * explore / official / pricing / compare and fallbacks.
 */
export function sectionOgImage({
  word,
  subtitle,
  wordSize,
}: {
  word: string;
  subtitle: string;
  wordSize?: number;
}) {
  return renderOg(
    <Frame>
      <WordHero text={word} size={wordSize} />
      <Lede text={subtitle} top={34} />
    </Frame>,
  );
}

/** Skill detail card. */
/**
 * Skill card: name and repo from the URL, and nothing else.
 *
 * Every element here is derived from the params, which is what lets the PNG
 * cache for a year (`OG_CACHE.YEAR`) instead of a day. The card used to carry
 * the skill's description, install count, curated-owner tag and audit verdict,
 * all read from Convex. Two reasons they went, Sep 2026:
 *
 *   - The description was already duplicated. `skillTabMetadata` in
 *     lib/skill-tab-route.tsx sets `openGraph.description`, and every unfurler
 *     prints that as text beside the image, so the card was spending a satori
 *     pass redrawing a sentence Slack and X were about to show anyway.
 *   - Anything read from Convex caps the PNG at `OG_CACHE.DAY`, because
 *     `s-maxage` cannot be tag-invalidated (see `OG_CACHE`). The install count
 *     moved daily and so pinned the whole card to a daily re-render: ~16k
 *     skills, each re-rendered every day, with no end state.
 *
 * What was genuinely lost is the "Official" and audit tags, the only two things
 * on the card not already in `og:title` / `og:description`. If either needs to
 * come back it brings the DAY ceiling back with it, so bring back the tag AND
 * the shorter lifetime together or the card will quietly lie for a year.
 *
 * The title is also now the URL slug, not the stored name. They differ for
 * ~2% of skills (432 of 20,000 in dev, Sep 2026), mostly namespaced names such
 * as `pinecone:docs` under the slug `pineconedocs`, and on those the card and
 * the `og:title` beside it disagree. Accepted as a known loss.
 */
export function skillOgImage(source: string, skillId: string) {
  const command = buildSkillInstallCommand(source, skillId);
  // A malformed source, NOT a missing skill. Existence is deliberately no
  // longer checked: the 404 branch renders a card too, so the lookup never
  // saved a render, it only chose which one to draw — and a Convex read that
  // picks between two equally expensive draws is not worth being a data
  // dependency that would drag the lifetime back down to a day.
  if (command === null) {
    return sectionOgImage({
      word: "404",
      subtitle: "This skill may have been delisted or moved.",
    });
  }

  return renderOg(
    <Frame category="Skill">
      <Title text={skillId} size={Math.min(nameSize(skillId), 54)} />
      <MetaLine text={source} />

      <div style={{ display: "flex", marginTop: 26 }}>
        <CommandRow command={command} />
      </div>
    </Frame>,
    { cache: OG_CACHE.YEAR },
  );
}

/** Bundle card: name, curator, and an overview of the whole bundle. `version`
 *  (the bundle's updatedAt) only keys the cache so edits produce a fresh render. */
export async function bundleOgImage(urlId: string, version: string) {
  const bundle = await loadBundle(urlId, version);

  if (!bundle) {
    return brandOgImage();
  }

  const count = bundle.skills.length;
  const totalInstalls = bundle.skills.reduce((sum, s) => sum + s.installs, 0);

  const stats: { value: string; label: string }[] = [
    { value: String(count), label: count === 1 ? "Skill" : "Skills" },
    { value: formatInstalls(totalInstalls), label: "Total installs" },
  ];
  return renderOg(
    <Frame category="Bundle">
      <Title text={bundle.name} size={nameSize(bundle.name)} />
      <Lede
        text={
          bundle.description
            ? truncate(bundle.description, 96)
            : `Curated by ${bundle.creatorName}`
        }
        top={18}
      />
      <StatStrip stats={stats} />
    </Frame>,
    { cache: OG_CACHE.DAY },
  );
}

/** Source / repo collection card. */
export async function sourceOgImage(source: string, category = "Source") {
  const { count, totalInstalls } = await loadSourceCounts(source);

  if (count === 0) {
    return sectionOgImage({
      word: source,
      subtitle: "No published skills found for this source.",
      wordSize: 64,
    });
  }

  return renderOg(
    <Frame category={category}>
      <Title text={source} size={nameSize(source)} />
      <Lede text="AI coding skills published by this source." top={18} />
      <StatStrip
        stats={[
          { value: String(count), label: count === 1 ? "Skill" : "Skills" },
          { value: formatInstalls(totalInstalls), label: "Total installs" },
        ]}
      />
    </Frame>,
    { cache: OG_CACHE.DAY },
  );
}

/** Org collection card. */
export async function orgOgImage(org: string) {
  const { repos, totalSkillCount, totalInstalls } = await loadOrg(org);

  if (!repos || repos.length === 0) {
    return sectionOgImage({
      word: org,
      subtitle: "No published skills found for this organization.",
      wordSize: 64,
    });
  }

  return renderOg(
    <Frame category="Organization">
      <Title text={org} size={nameSize(org)} />
      <Lede text="AI coding skills across this organization." top={18} />
      <StatStrip
        stats={[
          {
            value: String(repos.length),
            label: repos.length === 1 ? "Repository" : "Repositories",
          },
          {
            value: String(totalSkillCount),
            label: totalSkillCount === 1 ? "Skill" : "Skills",
          },
          { value: formatInstalls(totalInstalls), label: "Installs" },
        ]}
      />
    </Frame>,
    { cache: OG_CACHE.DAY },
  );
}
