/**
 * Read-only diagnostic: find GitHub-only rows whose stored `skillId` disagrees
 * with their SKILL.md's frontmatter `name`.
 *
 * skills.sh derives a slug from that name, so a row stored under a different
 * one is stuck: adoption matches on `source` + `skillId` and can never claim
 * it, reconcile skips GitHub-only rows, and if the real slug later reaches the
 * leaderboard `syncSkills` inserts a second row beside it. Re-pasting the link
 * doesn't repair it either — the row is live, so `terminalFor` answers
 * `already_exists` before the alias pass runs.
 *
 * Two ways such a row can exist, and it matters that neither is closed:
 *
 *   - It predates the frontmatter-name fix, when a GitHub-only add took its
 *     slug from the SKILL.md's folder name outright.
 *   - Its SKILL.md was bound by `matchesSkillId`'s loose prefix arm rather than
 *     by folder name, so `aliasCandidate` (lib/slugDecision.ts) deliberately
 *     declines to fire and the typed slug is kept. Narrow — the typed slug has
 *     to be a strict prefix of the kebab'd name with no folder of that name —
 *     but live. The prefix looseness itself is parked in TODO.md.
 *
 * The path that USED to keep producing these — an alias we couldn't verify,
 * falling back to the folder slug — now refuses the add instead
 * (`alias_unverifiable` in githubOnly.ts).
 *
 * Reports only. Re-slugging moves a skill's public URL and has to rewrite the
 * summary, embedding and search doc in step, and the right call depends on the
 * row, so it stays a per-row human decision. See TODO.md.
 *
 * Separate module from `githubOnly.ts` because that file is scoped to
 * "resolver + preview + confirm" and had grown past 1000 lines. The list query
 * stays on that side so the read and the fetch loop sit either side of the
 * query/action boundary they actually straddle.
 *
 * Note what the split does NOT buy: the types below still have to be declared
 * by hand. Moving the action to its own module looks like it should break the
 * circular inference, and it doesn't — the generated `internal` object is ONE
 * type covering every module, so any function that both reads `internal.*` and
 * is itself reachable through `internal.*` is self-referential regardless of
 * which file it lives in. It resolves to `any` and poisons the whole generated
 * `api` type, which surfaces as errors in unrelated files. The only fix is an
 * explicit annotation, the same reason `Precheck` is spelled out for
 * `getManualAddPrecheck` in skills.ts.
 */

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertAdmin } from "./devStats";
import { canonicalSlug } from "./lib/skillMatch";
import { extractSkillMdName } from "./skills";

/**
 * Why a row couldn't be judged. Kept separate from "mismatch" for the same
 * reason the resolver separates `tree_unavailable` from `no_skill_md`: "we
 * couldn't look" must never be reported as "we looked and it's wrong".
 */
const UNKNOWN_REASON = {
  noUrl: "no SKILL.md URL discovered yet",
  badHost: "SKILL.md URL is not on raw.githubusercontent.com",
  gone: "SKILL.md is no longer at that URL (404)",
  fetchFailed: "SKILL.md couldn't be fetched from GitHub",
  noFrontmatterName: "SKILL.md has no frontmatter `name`",
  unusableName: "frontmatter `name` can't be a slug",
  overCap: "not checked (audit cap reached)",
} as const;

/**
 * Bound on rows read AND SKILL.mds downloaded per run — one constant for both,
 * so the read can't quietly outgrow the fetch budget. The GitHub-only
 * population is small (a quota-limited fallback path), so this is a runaway
 * guard rather than an expected limit; anything past it is reported as
 * unchecked, never as sound.
 */
const FETCH_CAP = 200;
const WAVE_SIZE = 10;

/**
 * The only host a stored `skillMdUrl` may point at. Every writer constructs
 * `https://raw.githubusercontent.com/...` literally, so this is a convention
 * today — enforced here because this module is the second consumer to treat a
 * stored string as a fetchable URL, and an action is where an attacker-chosen
 * host would be a real SSRF.
 */
const ALLOWED_HOST = "raw.githubusercontent.com";

/** See the module header for why these are declared and not inferred. */
type GitHubOnlyRow = {
  source: string;
  skillId: string;
  name: string;
  isDelisted: boolean;
  skillMdUrl?: string;
};

type SlugAuditResult = {
  judged: number;
  total: number;
  truncated: boolean;
  mismatches: Array<{
    source: string;
    skillId: string;
    expectedSkillId: string;
    name: string;
    isDelisted: boolean;
  }>;
  unknown: Array<{ source: string; skillId: string; reason: string }>;
};

/**
 * Fetch one SKILL.md. Deliberately stronger than the resolver's `fetchText`:
 * it pins the host, splits a permanent 404 from a transient failure (a dead
 * row is actionable; an unlucky one isn't), and retries once, because the
 * content pipeline retries these same URLs up to 3 times and an audit that
 * judges "the file the pipeline fetches" shouldn't have weaker semantics than
 * the pipeline.
 */
async function fetchSkillMd(
  url: string,
): Promise<
  { ok: true; body: string } | { ok: false; reason: string }
> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { ok: false, reason: UNKNOWN_REASON.badHost };
  }
  if (host !== ALLOWED_HOST) {
    return { ok: false, reason: UNKNOWN_REASON.badHost };
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.ok) return { ok: true, body: await res.text() };
      // Permanent: the file moved or the repo went away. Don't retry, and
      // don't file it beside a throttled request.
      if (res.status === 404) return { ok: false, reason: UNKNOWN_REASON.gone };
    } catch {
      // Network-level throw — treated like a non-ok response, same as the
      // resolver does, so it can be retried rather than escaping.
    }
  }
  return { ok: false, reason: UNKNOWN_REASON.fetchFailed };
}

export const auditGitHubOnlySlugs = action({
  args: {},
  returns: v.object({
    // Rows we actually compared. Distinct from `total` on purpose: reporting
    // the population as "checked" is how a run where nothing could be read
    // still prints a clean bill of health.
    judged: v.number(),
    total: v.number(),
    /** More GitHub-only rows exist than this run read. */
    truncated: v.boolean(),
    mismatches: v.array(
      v.object({
        source: v.string(),
        skillId: v.string(),
        expectedSkillId: v.string(),
        name: v.string(),
        isDelisted: v.boolean(),
      }),
    ),
    unknown: v.array(
      v.object({
        source: v.string(),
        skillId: v.string(),
        reason: v.string(),
      }),
    ),
  }),
  handler: async (ctx): Promise<SlugAuditResult> => {
    await assertAdmin(ctx);
    // One extra row is the overflow probe: getting it back means more exist
    // than we're willing to read in one pass.
    const rows = (await ctx.runQuery(internal.githubOnly.listGitHubOnlyRows, {
      limit: FETCH_CAP + 1,
    })) as GitHubOnlyRow[];
    const truncated = rows.length > FETCH_CAP;
    const readable = rows.slice(0, FETCH_CAP);

    const mismatches: SlugAuditResult["mismatches"] = [];
    const unknown: SlugAuditResult["unknown"] = [];
    const skip = (
      row: { source: string; skillId: string },
      reason: string,
    ) => unknown.push({ source: row.source, skillId: row.skillId, reason });

    if (truncated) {
      for (const row of rows.slice(FETCH_CAP)) {
        skip(row, UNKNOWN_REASON.overCap);
      }
    }

    // Narrowed on the way in, so the fetch loop needs no cast for the URL.
    const fetchable: Array<GitHubOnlyRow & { skillMdUrl: string }> = [];
    for (const row of readable) {
      if (!row.skillMdUrl) {
        skip(row, UNKNOWN_REASON.noUrl);
        continue;
      }
      fetchable.push({ ...row, skillMdUrl: row.skillMdUrl });
    }

    let judged = 0;
    for (let i = 0; i < fetchable.length; i += WAVE_SIZE) {
      const wave = fetchable.slice(i, i + WAVE_SIZE);
      const results = await Promise.all(
        wave.map((row) => fetchSkillMd(row.skillMdUrl)),
      );
      for (let j = 0; j < wave.length; j++) {
        const row = wave[j];
        const result = results[j];
        if (!result.ok) {
          skip(row, result.reason);
          continue;
        }
        const fmName = extractSkillMdName(result.body);
        if (!fmName) {
          skip(row, UNKNOWN_REASON.noFrontmatterName);
          continue;
        }
        const expected = canonicalSlug(fmName);
        if (expected === null) {
          // The name can't be a slug at all, so there is nothing to compare
          // against — and nothing this row could be re-slugged TO either.
          skip(row, UNKNOWN_REASON.unusableName);
          continue;
        }
        judged++;
        if (expected !== row.skillId) {
          mismatches.push({
            source: row.source,
            skillId: row.skillId,
            expectedSkillId: expected,
            name: row.name,
            isDelisted: row.isDelisted,
          });
        }
      }
    }
    return { judged, total: rows.length, truncated, mismatches, unknown };
  },
});
