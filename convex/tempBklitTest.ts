/**
 * TEMPORARY diagnostic — safe to delete.
 *
 * Tests whether the skills.sh v1 API returns the `bklit/bklit-ui/bklit-ui`
 * skill, using the deployment's SKILLS_SH_API_KEY (same auth path as the real
 * sync). Run against the deployment whose env holds the key:
 *
 *   npx convex run tempBklitTest:testBklit            # dev
 *   npx convex run tempBklitTest:testBklit --prod     # prod
 *
 * Reports three things:
 *   1. detail   — GET /skills/bklit/bklit-ui/bklit-ui (does the skill exist?)
 *   2. search   — GET /skills/search?q=bklit          (is it indexed/searchable?)
 *   3. listing  — scans the all-time leaderboard for the row, and reports its
 *                 installs vs. our MIN_INSTALLS=50 sync threshold.
 */
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { getSkillDetail, listSkills } from "./lib/skillsApi";

const SOURCE = "bklit/bklit-ui";
const SLUG = "bklit-ui";
const MIN_INSTALLS = 50; // mirror of the constant in skills.ts

export const testBklit = internalAction({
  args: {},
  handler: async () => {
    const out: Record<string, unknown> = {
      keyPresent: !!process.env.SKILLS_SH_API_KEY,
    };

    // 1. Detail endpoint — the authoritative "does this skill exist on skills.sh"
    try {
      const detail = await getSkillDetail(SOURCE, SLUG);
      out.detail = {
        ok: true,
        id: detail.id,
        installs: detail.installs,
        hash: detail.hash,
        fileCount: detail.files?.length ?? 0,
        hasSkillMd: !!detail.files?.some((f) => f.path === "SKILL.md"),
        meetsMinInstalls: detail.installs >= MIN_INSTALLS,
      };
    } catch (e) {
      out.detail = { ok: false, error: String(e) };
    }

    // 2. Search endpoint — direct fetch (no wrapper exists for /search).
    try {
      const key = process.env.SKILLS_SH_API_KEY;
      const res = await fetch(
        "https://www.skills.sh/api/v1/skills/search?q=bklit&limit=50",
        {
          headers: {
            Accept: "application/json",
            "User-Agent": "SkillBundle",
            ...(key ? { Authorization: `Bearer ${key}` } : {}),
          },
        },
      );
      if (!res.ok) {
        out.search = { ok: false, status: res.status, body: (await res.text()).slice(0, 200) };
      } else {
        const json = (await res.json()) as { data?: Array<{ id: string; installs: number }> };
        const rows = json.data ?? [];
        out.search = {
          ok: true,
          total: rows.length,
          bklitHits: rows
            .filter((r) => r.id.startsWith("bklit/"))
            .map((r) => ({ id: r.id, installs: r.installs })),
        };
      }
    } catch (e) {
      out.search = { ok: false, error: String(e) };
    }

    // 3. Leaderboard scan — walk all-time pages looking for the row. Stop after
    //    a bounded number of pages so this can't run away.
    try {
      let page = 0;
      let found: { id: string; installs: number; rank: number } | null = null;
      let scanned = 0;
      const MAX_PAGES = 30; // 30 * 500 = 15k rows
      while (page < MAX_PAGES) {
        const { data, pagination } = await listSkills({
          view: "all-time",
          page,
          perPage: 500,
        });
        for (let i = 0; i < data.length; i++) {
          if (data[i].source === SOURCE && data[i].slug === SLUG) {
            found = {
              id: data[i].id,
              installs: data[i].installs,
              rank: page * 500 + i + 1,
            };
            break;
          }
        }
        scanned += data.length;
        if (found || !pagination.hasMore) break;
        page++;
      }
      out.listing = { found, scannedRows: scanned, pagesScanned: page + 1 };
    } catch (e) {
      out.listing = { ok: false, error: String(e) };
    }

    console.log("bklit test result:", JSON.stringify(out, null, 2));
    return out;
  },
});
