/**
 * Read-only diagnostic: is the RIGHT SKILL.md bound to each skill?
 *
 * Different question from `githubOnlyAudit.ts`, which asks "does this row's slug
 * match its file's name?" over GitHub-only rows. That one covers ~2 rows. This
 * one covers every GitHub-sourced row with a bound file — roughly the whole
 * catalog — because the defect it looks for was in a code path they all went
 * through.
 *
 * **What it looks for.** Until Jul 2026, `discoverSkillMdUrls` pass 1 bound a
 * SKILL.md to a skill purely because the folder was named like the slug, without
 * opening the file. So a repo holding one skill's folder named like ANOTHER
 * skill's name would bind the wrong file, and the content pipeline would then
 * serve that file's body under the first skill's name, silently.
 *
 * A verification step in pass 1 was tried and reverted once this audit measured
 * the problem: zero confirmable wrong binds in 13,080 production rows, against 12
 * healthy binds it would have refused. Detection lives here instead, on demand,
 * where a false positive costs a line of output rather than a skill's content.
 *
 * **Why the loose matcher and not the strict one.** `matchesSkillId`, not
 * `canonicalSlug` equality. These slugs came from skills.sh, which derives them
 * from names in ways `kebabCase` cannot reproduce (a name of "Next.js
 * Development" kebabs to `next.js-development`, while the slug is
 * `next-js-development`). A strict comparison would report a large fraction of a
 * healthy catalog. Reporting only where even the LOOSE rule fails means a hit is
 * a file that does not plausibly correspond to its slug at all — which is the
 * signal. Prefer a missed case to a false accusation — which is precisely the
 * lesson the reverted pass-1 check taught at the cost of two review rounds.
 *
 * **Reports only, and that is now the whole design rather than a first step.** A
 * hit needs a human: of the 50 flagged in the first production run (Jul 2026,
 * BEFORE `kebabCase` was aligned to fold `_`), 38 were skills.sh slug derivations
 * `kebabCase` cannot reproduce and 12 were repos reusing one name across folders.
 * None was a wrong bind. A re-run should report FEWER than 50 — at minimum
 * `github/gh-aw/http-mcp-headers` drops out, since its file is named
 * `http_mcp_headers` and that now folds to the slug. Treat a lower number as the
 * alignment working, not as drift. Acting automatically on
 * this signal is what the reverted pass-1 check did, and it was wrong 12 times
 * out of 12.
 *
 * **Run it from the CLI**, not a dev card: it is a one-off backward-looking check
 * over ~9.5k rows, not something to leave a button for.
 *
 *   npx convex run bindAudit:auditSkillMdBinds '{"cursor":null}'
 *
 * Pass the returned `cursor` back to continue; null means the walk finished.
 *
 * `internalAction` rather than an admin-gated `action` because the CLI runs with
 * deployment credentials, so there is no caller identity to gate on and no
 * reason to expose it publicly.
 *
 * The hand-declared types below are for the same reason as
 * `githubOnlyAudit.ts`'s: the generated `internal` object is ONE type spanning
 * every module, so a function that both reads `internal.*` and is reachable
 * through it is self-referential and resolves to `any`, poisoning the generated
 * `api` type. An explicit annotation is the only fix.
 */

import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { matchesSkillId, kebabCase } from "./lib/skillMatch";
import { parseSkillMdName } from "./lib/github";
import { isGitHubSource } from "./lib/source";
import {
  AUDIT_PAGE_SIZE,
  UNKNOWN_REASON,
  WAVE_SIZE,
  fetchSkillMd,
} from "./githubOnlyAudit";

/** See the module header for why these are declared and not inferred. */
type BoundRow = {
  source: string;
  skillId: string;
  skillMdUrl: string;
  isDelisted: boolean;
  isGitHubOnly: boolean;
};

type BindAuditResult = {
  /** Rows that produced a real comparison, in THIS page. */
  judged: number;
  /** Rows this page READ. Not the population — pass the cursor back for more. */
  read: number;
  /** Pass back as `cursor` to continue. Null when the walk reached the end. */
  cursor: string | null;
  /**
   * A bound file whose own `name` does not correspond to the row's slug even
   * under the loose rule. `claimsSlug` is what the file's name kebabs to, which
   * is usually the answer to "whose file is this?" — if it matches another skill
   * in the same repo, that is the collision this audit was built to find.
   */
  mismatches: Array<{
    source: string;
    skillId: string;
    skillMdUrl: string;
    fileName: string;
    claimsSlug: string;
    isDelisted: boolean;
    isGitHubOnly: boolean;
  }>;
  unknown: Array<{ source: string; skillId: string; reason: string }>;
};

/**
 * GitHub-sourced rows that have a bound SKILL.md, newest first.
 *
 * Filters `isGitHubSource` in the handler rather than by index: well-known
 * sources (mintlify.com and friends) get their content from the skills.sh detail
 * endpoint, never from a folder-name guess, so they were never exposed to the
 * defect. They are a small minority, so filtering after the read costs less than
 * a new index would.
 */
export const listBoundRows = internalQuery({
  args: { limit: v.number(), cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    rows: v.array(
      v.object({
        source: v.string(),
        skillId: v.string(),
        skillMdUrl: v.string(),
        isDelisted: v.boolean(),
        isGitHubOnly: v.boolean(),
      }),
    ),
    cursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { limit, cursor }) => {
    const page = await ctx.db
      .query("skillSummaries")
      .withIndex("by_hasSkillMdUrl", (q) => q.eq("hasSkillMdUrl", true))
      .order("desc")
      .paginate({ numItems: limit, cursor });
    return {
      rows: page.page.flatMap((r) =>
        r.skillMdUrl && isGitHubSource(r.source)
          ? [
              {
                source: r.source,
                skillId: r.skillId,
                skillMdUrl: r.skillMdUrl,
                isDelisted: r.isDelisted,
                isGitHubOnly: r.isGitHubOnly ?? false,
              },
            ]
          : [],
      ),
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});

export const auditSkillMdBinds = internalAction({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }): Promise<BindAuditResult> => {
    const page: { rows: BoundRow[]; cursor: string | null } =
      await ctx.runQuery(internal.bindAudit.listBoundRows, {
        limit: AUDIT_PAGE_SIZE,
        cursor: cursor ?? null,
      });

    const mismatches: BindAuditResult["mismatches"] = [];
    const unknown: BindAuditResult["unknown"] = [];
    let judged = 0;

    for (let i = 0; i < page.rows.length; i += WAVE_SIZE) {
      const wave = page.rows.slice(i, i + WAVE_SIZE);
      const results = await Promise.all(
        wave.map((row) => fetchSkillMd(row.skillMdUrl)),
      );
      for (let j = 0; j < wave.length; j++) {
        const row = wave[j];
        const result = results[j];
        if (!result.ok) {
          // "We couldn't look" is reported apart from "we looked and it's
          // wrong", the same rule the slug audit follows. A fetch failure here
          // says nothing about the bind.
          unknown.push({
            source: row.source,
            skillId: row.skillId,
            reason: result.reason,
          });
          continue;
        }
        const fileName = parseSkillMdName(result.body);
        if (!fileName) {
          unknown.push({
            source: row.source,
            skillId: row.skillId,
            reason: UNKNOWN_REASON.noFrontmatterName,
          });
          continue;
        }
        judged++;
        if (!matchesSkillId(fileName, row.skillId)) {
          mismatches.push({
            source: row.source,
            skillId: row.skillId,
            skillMdUrl: row.skillMdUrl,
            fileName,
            claimsSlug: kebabCase(fileName),
            isDelisted: row.isDelisted,
            isGitHubOnly: row.isGitHubOnly,
          });
        }
      }
    }

    console.log(
      `bind audit: judged ${judged} of ${page.rows.length} read, ` +
        `${mismatches.length} mismatched, ${unknown.length} unjudgeable, ` +
        `cursor ${page.cursor === null ? "(end)" : page.cursor}`,
    );
    for (const m of mismatches) {
      console.log(
        `  MISBOUND ${m.source}/${m.skillId} → ${m.skillMdUrl} is named "${m.fileName}" (claims ${m.claimsSlug})`,
      );
    }

    return {
      judged,
      read: page.rows.length,
      cursor: page.cursor,
      mismatches,
      unknown,
    };
  },
});
