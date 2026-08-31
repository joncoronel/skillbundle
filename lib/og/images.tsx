import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { formatInstalls } from "@/lib/utils";
import { buildSkillInstallCommand } from "@/lib/install-commands";
import { loadSkill, SKILL_SYNC_TAG } from "@/lib/skill-cache";
import { og } from "./theme";
import { FONT } from "./fonts";
import {
  BrandHero,
  CommandRow,
  Frame,
  Lede,
  MetaLine,
  StatStrip,
  Tag,
  Title,
  WordHero,
  renderOg,
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
 * Identity rule: one family, with the display end built from weight and
 * tracking. Section words, the wordmark and every figure are set at 700 and
 * tracked hard so the card reads at a glance; variable-length names and prose
 * stay at body weight and normal tracking.
 */

// ── Cached loaders ──────────────────────────────────────────────────────────

// `loadSkill` is imported from lib/skill-cache.ts rather than redeclared here.
// It used to be a local copy, which meant every OG render wrote a second cache
// entry for a row the detail page had already cached (`'use cache'` keys on
// function identity, so identical bodies are still separate entries) — and,
// being untagged, rewrote it every 24h instead of when the content changed.
//
// The loaders below stay local: each is specific to one OG surface, and none of
// them has a second consumer to share with.

// Install count for the skill card, kept OUT of the shared `loadSkill` entry on
// purpose. `loadSkill` is "skill-content"-tagged and now lives for weeks; the
// install number moves daily, so reading `skill.installs` off that row would
// freeze the figure on every social card for up to 7 days. This mirrors what
// components/skill-sidebar.tsx does for the page itself — the invariant is that
// a daily-cadence number is only ever read from a "skill-sync"-tagged entry.
async function loadSkillInstalls(source: string, skillId: string) {
  "use cache";
  cacheLife("days");
  cacheTag(SKILL_SYNC_TAG);
  // `getInstallCount`, not `getInsights` — the card shows one integer, and
  // getInsights would collect 90 days of snapshot rows to produce it.
  return fetchQuery(api.skills.getInstallCount, { source, skillId });
}

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
export async function skillOgImage(source: string, skillId: string) {
  const [skill, installs] = await Promise.all([
    loadSkill(source, skillId),
    loadSkillInstalls(source, skillId),
  ]);

  if (!skill) {
    return sectionOgImage({
      word: "404",
      subtitle: "This skill may have been delisted or moved.",
    });
  }

  const command = buildSkillInstallCommand(source, skillId);
  if (command === null) {
    return sectionOgImage({
      word: "404",
      subtitle: "This skill may have been delisted or moved.",
    });
  }

  const name = skill.name || skillId;
  const audit = auditTag(skill.worstAuditStatus, skill.worstAuditRiskLevel);

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
        <StatStrip
          top={0}
          stats={[
            {
              // null = orphaned skill row; a dash beats a confident "0".
              value: installs == null ? "—" : formatInstalls(installs),
              label: "installs",
            },
          ]}
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
    { cache: true },
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
