import "server-only";
import { unstable_cache } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { formatInstalls } from "@/lib/utils";
import { isGitHubSource } from "@/lib/skill-urls";
import { og } from "./theme";
import { FONT } from "./fonts";
import {
  BrandHero,
  CommandRow,
  Frame,
  Lede,
  MetaLine,
  PixelHero,
  PixelStatStrip,
  Tag,
  Title,
  renderOg,
  truncate,
} from "./templates";

/**
 * High-level OG image builders, one per surface. Data-backed builders fetch
 * through `unstable_cache` so the underlying `fetchQuery` (which forces
 * `no-store`) doesn't make the image route render dynamically on every crawl.
 *
 * Identity rule: the Geist Pixel face appears big — section words, the
 * wordmark, every figure — so the brand reads at a glance. Variable-length
 * names and prose stay in Geist Sans.
 */

// ── Cached loaders ──────────────────────────────────────────────────────────

const loadSkill = unstable_cache(
  (source: string, skillId: string) =>
    fetchQuery(api.skills.getBySourceAndSkillId, { source, skillId }),
  ["og-skill"],
  { revalidate: 86400 },
);

// Keyed by (urlId, version): `version` is the bundle's updatedAt, passed only
// so it becomes part of the cache key (unstable_cache keys on the args). A new
// version → a fresh entry → the next render reflects the edit; an unchanged
// version is served from cache. The 1-day revalidate is a backstop for install
// counts that drift via the daily sync without bumping updatedAt. Public
// bundles only (no auth token) — private ones return null → brand fallback.
const loadBundle = unstable_cache(
  (urlId: string, version: string) => {
    void version;
    return fetchQuery(api.bundles.getByUrlId, { urlId });
  },
  ["og-bundle"],
  { revalidate: 86400 },
);

const loadSourceSkills = unstable_cache(
  async (source: string) => {
    const skills = await fetchQuery(api.skills.listBySource, { source });
    const visible = skills.filter((s) => !s.isDelisted);
    return {
      count: visible.length,
      totalInstalls: visible.reduce((sum, s) => sum + s.installs, 0),
    };
  },
  ["og-source-skills"],
  { revalidate: 86400 },
);

const loadOrg = unstable_cache(
  (org: string) => fetchQuery(api.skills.listRepoAggregatesByOrg, { org }),
  ["og-org"],
  { revalidate: 86400 },
);

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
 * Generic section card: a short word in the pixel face as the hero, plus a
 * Geist subtitle. For explore / official / pricing / compare and fallbacks.
 */
export function sectionOgImage({
  word,
  subtitle,
  pixelSize,
}: {
  word: string;
  subtitle: string;
  pixelSize?: number;
}) {
  return renderOg(
    <Frame>
      <PixelHero text={word} size={pixelSize} />
      <Lede text={subtitle} top={34} />
    </Frame>,
  );
}

/** Skill detail card. */
export async function skillOgImage(source: string, skillId: string) {
  const skill = await loadSkill(source, skillId);

  if (!skill) {
    return sectionOgImage({
      word: "404",
      subtitle: "This skill may have been delisted or moved.",
    });
  }

  const name = skill.name || skillId;
  const audit = auditTag(skill.worstAuditStatus, skill.worstAuditRiskLevel);
  const command = isGitHubSource(source)
    ? `npx skills add ${source} --skill ${skillId}`
    : `npx skills add ${source}/${skillId}`;

  return renderOg(
    <Frame category="Skill">
      <Title text={name} size={Math.min(nameSize(name), 54)} />
      <MetaLine text={source} />
      {skill.description ? (
        <Lede text={truncate(skill.description, 92)} top={16} />
      ) : null}

      <div style={{ display: "flex", marginTop: 26 }}>
        <CommandRow command={command} />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginTop: 30,
        }}
      >
        <PixelStatStrip
          top={0}
          stats={[{ value: formatInstalls(skill.installs), label: "installs" }]}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            alignItems: "flex-end",
          }}
        >
          {skill.curatedOwner ? (
            <Tag label={`Official · ${skill.curatedOwner}`} tone="accent" />
          ) : null}
          {audit ? <Tag label={audit.label} tone={audit.tone} /> : null}
        </div>
      </div>
    </Frame>,
    { cache: true },
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
  if (bundle.starCount > 0) {
    stats.push({
      value: formatInstalls(bundle.starCount),
      label: bundle.starCount === 1 ? "Star" : "Stars",
    });
  }

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
      <PixelStatStrip stats={stats} />
    </Frame>,
    { cache: true },
  );
}

/** Source / repo collection card. */
export async function sourceOgImage(source: string, category = "Source") {
  const { count, totalInstalls } = await loadSourceSkills(source);

  if (count === 0) {
    return sectionOgImage({
      word: source,
      subtitle: "No published skills found for this source.",
      pixelSize: 64,
    });
  }

  return renderOg(
    <Frame category={category}>
      <Title text={source} size={nameSize(source)} />
      <Lede text="AI coding skills published by this source." top={18} />
      <PixelStatStrip
        stats={[
          { value: String(count), label: count === 1 ? "Skill" : "Skills" },
          { value: formatInstalls(totalInstalls), label: "Total installs" },
        ]}
      />
    </Frame>,
    { cache: true },
  );
}

/** Org collection card. */
export async function orgOgImage(org: string) {
  const { repos, totalSkillCount, totalInstalls } = await loadOrg(org);

  if (!repos || repos.length === 0) {
    return sectionOgImage({
      word: org,
      subtitle: "No published skills found for this organization.",
      pixelSize: 64,
    });
  }

  return renderOg(
    <Frame category="Organization">
      <Title text={org} size={nameSize(org)} />
      <Lede text="AI coding skills across this organization." top={18} />
      <PixelStatStrip
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
    { cache: true },
  );
}

// ── helpers ──────────────────────────────────────────────────────────────

function auditTag(
  status: string | undefined,
  risk: string | undefined,
): { label: string; tone: "warning" | "danger" } | null {
  if (status === "fail") {
    return {
      label: risk ? `Risk · ${risk.toUpperCase()}` : "Audit · Fail",
      tone: "danger",
    };
  }
  if (status === "warn") {
    return {
      label: risk ? `Review · ${risk.toUpperCase()}` : "Audit · Review",
      tone: "warning",
    };
  }
  return null;
}
