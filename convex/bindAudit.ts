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
 * hit needs a human. Latest production run (Jul 2026, AFTER `kebabCase` was
 * aligned to fold `_`): 13,264 rows read, 13,080 judged, **49 flagged, none a
 * wrong bind**, 184 unjudgeable (152 files now 404, 32 with no frontmatter
 * `name`). The 49 are all skills.sh slug derivations `kebabCase` cannot
 * reproduce:
 *
 *   - 30 namespace prefixes, in BOTH directions — file `webflow-mcp:site-activity`
 *     against slug `site-activity` (12 of these), `n8n:` (10), `stitch::` (2), and
 *     the reverse where the SLUG carries `ckm:` and the file's name is bare (6).
 *   - 18 where the slug is more specific than the file's own name, because
 *     skills.sh took it from the folder: `tailwind-css` ← `tailwind`,
 *     `sqlalchemy-orm` ← `sqlalchemy`, `drizzle-orm` ← `drizzle`.
 *   - 1 punctuation collapse: `Update Pub/Sub Emulator` → `update-pubsub-emulator`.
 *
 * The pre-alignment run flagged 50. Exactly one row dropped out, and it is the
 * predicted one: `github/gh-aw/http-mcp-headers`, whose file is named
 * `http_mcp_headers`. That is the alignment confirmed end to end — it is the row
 * that motivated the change in the first place.
 *
 * Acting automatically on this signal is what the reverted pass-1 check did, and
 * it was wrong 12 times out of 12.
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
import { matchesSkillId, kebabCase, foldSeparators } from "./lib/skillMatch";
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

/**
 * Census: how many stored slugs contain a separator that now folds, and do any
 * two rows in one repo collapse to the same folded key?
 *
 * The second question is the one that matters. Folding separators on the slug
 * side means `my_skill` and `my-skill` become the same key, so both rows match
 * the same candidate in discovery's exact phase and whichever loses is left with
 * no file. That shape has never been observed; this counts it rather than
 * guessing, which is the gate the review asked for before this reaches a
 * `syncSkills` run.
 *
 *   npx convex run --prod bindAudit:censusSeparatorSlugs '{"cursor":null}'
 *
 * Read-only, CLI-run, and cheap: one paginated table scan, no GitHub calls.
 *
 * PRODUCTION (Jul 2026): 15,442 rows, ONE slug with a folding separator
 * (`meission/eastmoney` → `eastmoney_financial_data`), ZERO collisions. The shape
 * this query was built to find does not exist in production at all.
 *
 * Dev, for contrast: 23,753 rows, 14 folding slugs, one collision
 * (`everyinc/compound-engineering-plugin` holding both `resolve_pr_parallel` and
 * `resolve-pr-parallel`, both delisted with `skillMdUrl: ""`, so inert). Dev
 * carries seeded junk — reading it as the real population would have overstated
 * the hazard 14×. Measure production before concluding anything from this.
 *
 * TWO THINGS THIS DOES NOT COUNT:
 *
 *   1. Collisions are detected PER PAGE (see below), so one split across a page
 *      boundary is missed. Rows for a repo are usually written together, which
 *      makes the blind spot small rather than zero.
 *   2. The exact-key collision is not the only widening. Folding the slug side of
 *      `matchesSkillId`'s PREFIX arm also newly matches across separator styles:
 *      slug `foo_bar` now claims a file named `Foo Bar Baz`, and slug `foo-bar`
 *      one named `Foo_Bar Baz` — both false before this branch, both true now.
 *      (Not because the prefix arm was dead for underscores: the old `kebabCase`
 *      left `_` in place, so `foo_bar` already matched `Foo_Bar Baz`. What
 *      changed is that the two styles now cross.) Additive at the matcher, but
 *      discovery's scan is first-match-wins, so a newly-matching row can take a
 *      file another row would have had.
 */
export const censusSeparatorSlugs = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    read: v.number(),
    withSeparator: v.array(v.string()),
    collisions: v.array(v.string()),
    cursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("skillSummaries")
      .paginate({ numItems: 2000, cursor });
    const withSeparator: string[] = [];
    // Folded key -> the raw slugs in that repo that produced it. Page-local, so
    // a collision split across a page boundary is missed; the folded key is
    // reported alongside so successive pages can be diffed if it ever matters.
    const byFolded = new Map<string, string[]>();
    for (const r of page.page) {
      const folded = foldSeparators(r.skillId);
      if (folded !== r.skillId) withSeparator.push(`${r.source}/${r.skillId}`);
      const key = `${r.source}/${folded}`;
      const seen = byFolded.get(key) ?? [];
      seen.push(r.skillId);
      byFolded.set(key, seen);
    }
    const collisions: string[] = [];
    for (const [key, slugs] of byFolded) {
      if (slugs.length > 1) collisions.push(`${key} <- ${slugs.join(", ")}`);
    }
    return {
      read: page.page.length,
      withSeparator,
      collisions,
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});
