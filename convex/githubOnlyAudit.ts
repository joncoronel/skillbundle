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
  redirectedOffHost: "SKILL.md URL redirected off raw.githubusercontent.com",
  gone: "SKILL.md is no longer at that URL (404)",
  fetchFailed: "SKILL.md couldn't be fetched from GitHub",
  noFrontmatterName: "SKILL.md has no frontmatter `name`",
  unusableName: "frontmatter `name` can't be a slug",
} as const;

/**
 * Rows read AND SKILL.mds downloaded per PAGE — one constant for both, so the
 * read can never outgrow the fetch budget.
 *
 * This is a page size, not a ceiling on what the audit can cover: the result
 * carries a `cursor` and the caller asks for the next page, so the whole
 * population is reachable. It stays bounded per call because each row costs a
 * GitHub fetch (an action has a time limit) and because an unbounded DB read
 * would blow the transaction read limit — at a row count far below the fetch
 * budget, i.e. it would fail exactly when the population became worth auditing.
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
  /** Rows that produced a real comparison, in THIS page. */
  judged: number;
  /**
   * Rows this page READ — not the population. Named `read` rather than `total`
   * so a partial audit can't read as a complete one: with 5,000 GitHub-only
   * rows, a `total` of 200 would look like a near-complete audit of a
   * population it never saw.
   */
  read: number;
  /**
   * Pass back as `cursor` to audit the next page. Null when this page reached
   * the end, i.e. the whole population has now been covered.
   *
   * The caller holds it rather than the server persisting progress: an audit is
   * admin-triggered and its useful answer is "is anything wrong right now", so
   * resuming a run from hours ago would be a stranger contract than continuing
   * one you're looking at.
   */
  cursor: string | null;
  mismatches: Array<{
    source: string;
    skillId: string;
    expectedSkillId: string;
    name: string;
    isDelisted: boolean;
  }>;
  unknown: Array<{ source: string; skillId: string; reason: string }>;
};

/** HTTPS on the one allowed host, and nothing else. Unparseable counts as not
 *  allowed. Used both before the request and again on the URL it landed on. */
function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === ALLOWED_HOST;
  } catch {
    return false;
  }
}

/** Attempts per URL, and the pause before a retry. Mirrors the linear backoff
 *  in `withTransientRetry` (lib/skillsApi.ts) — a zero-delay second attempt
 *  lands inside the same throttle window as the first and fails identically,
 *  which is the one case the retry exists for. */
const FETCH_ATTEMPTS = 2;
const RETRY_DELAY_MS = 500;

/**
 * Fetch one SKILL.md. Deliberately stronger than the resolver's `fetchText`:
 * it pins the scheme and host, splits a permanent 404 from a transient failure
 * (a dead row is actionable; an unlucky one isn't), and retries with a pause,
 * because the content pipeline retries these same URLs up to 3 times and an
 * audit that judges "the file the pipeline fetches" shouldn't have weaker
 * semantics than the pipeline.
 *
 * Redirects are FOLLOWED and the host re-checked afterwards, rather than
 * refused. Under `redirect: "manual"` a 3xx arrives as an opaque response with
 * `status: 0`, so the 404 split above it could never fire for a redirected URL
 * and every redirect would be filed as transient — while the pipeline, which
 * follows redirects, fetches the file fine. Re-asserting the host on `res.url`
 * keeps the SSRF guard intact without throwing away the status.
 */
async function fetchSkillMd(
  url: string,
): Promise<{ ok: true; body: string } | { ok: false; reason: string }> {
  // Scheme as well as host: a stored `http://` URL would otherwise be fetched
  // in cleartext, exposing which rows an admin is diagnosing and letting a
  // network attacker tamper with the frontmatter this then parses.
  if (!isAllowedUrl(url)) {
    return { ok: false, reason: UNKNOWN_REASON.badHost };
  }
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
    try {
      const res = await fetch(url);
      // `res.url` empty means the runtime gave us no redirect information, not
      // that we were redirected — parsing it unguarded would throw into the
      // catch below and degrade EVERY row to `fetchFailed`. Absent info means
      // no redirect happened, which the pre-fetch check above already cleared.
      if (res.url && !isAllowedUrl(res.url)) {
        // Its own reason, not `badHost`: the STORED url is on the allowed host
        // in this case, so saying otherwise would assert something untrue about
        // the row the card names.
        return { ok: false, reason: UNKNOWN_REASON.redirectedOffHost };
      }
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
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({
    // Rows actually compared, kept distinct from `read` on purpose: reporting
    // rows we merely looked at as "checked" is how a run where nothing could be
    // fetched still prints a clean bill of health.
    judged: v.number(),
    read: v.number(),
    cursor: v.union(v.string(), v.null()),
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
  handler: async (ctx, { cursor }): Promise<SlugAuditResult> => {
    await assertAdmin(ctx);
    // Annotated, not `as`-cast: the handler's own return annotation is what
    // breaks the inference cycle, so the assertion bought nothing here and
    // silently opted out of the one check that keeps this shape and the query's
    // return validator agreeing. An annotation is checked.
    const page: { rows: GitHubOnlyRow[]; cursor: string | null } =
      await ctx.runQuery(internal.githubOnly.listGitHubOnlyRows, {
        limit: FETCH_CAP,
        cursor,
      });
    const readable = page.rows;

    const mismatches: SlugAuditResult["mismatches"] = [];
    const unknown: SlugAuditResult["unknown"] = [];
    const skip = (
      row: { source: string; skillId: string },
      reason: string,
    ) => unknown.push({ source: row.source, skillId: row.skillId, reason });

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
    return {
      judged,
      read: readable.length,
      cursor: page.cursor,
      mismatches,
      unknown,
    };
  },
});
