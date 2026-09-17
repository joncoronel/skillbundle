/**
 * Well-known source index probing.
 *
 * A "well-known" source is a domain (e.g. "open.feishu.cn") that publishes its
 * skills under `/.well-known/skills/index.json` or
 * `/.well-known/agent-skills/index.json`, rather than a GitHub repo. This
 * module answers ONE question per domain: can the `skills` CLI install from it
 * given only the domain, and which skill names would it see?
 *
 * Why it has to ask at all — the command is not derivable from the source
 * string. Reading the CLI's own parser (`skills@1.7.0`, `parseSource`):
 *
 *   - `owner/repo` is GitHub shorthand, so `npx skills add bun.sh/bun` resolves
 *     to `github.com/bun.sh/bun.git` and fails. That is the command the site
 *     pages printed until this module existed.
 *   - A bare `bun.sh` has no slash, so it falls through to "treat as a git
 *     remote" and fails too.
 *   - The well-known branch requires an ABSOLUTE url: `npx skills add
 *     https://bun.sh/docs`. The CLI then tries the index under that url's path
 *     first and the domain root second.
 *
 * We can build `https://{source}` but never the base path, and skills.sh's API
 * returns `installUrl: null` for every well-known skill, so there is nothing to
 * copy either. Probing the root is the only thing left, and it is enough for
 * most of the catalog — measured Sep 2026: 19 of 26 domains answer at the root,
 * covering 109 of 165 well-known skills. The other seven stay silent, which is
 * the point: bun.sh's index is gone entirely and mintlify.com publishes under a
 * base path, so any command we printed for them would fail.
 *
 * Cadence is weekly, not daily. The inputs are a publisher's own index file and
 * the set of domains in the catalog; both change on the order of months, and
 * the source scan is the one expensive part (a full walk of skillSummaries).
 * Run it by hand after adding a site skill rather than waiting a week:
 *   npx convex run wellKnown:refreshWellKnownIndexes
 */
import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { isGitHubSource } from "./lib/source";

// The two paths the CLI tries, in its order. First one to answer with a
// parseable index wins, which mirrors what the CLI itself would pick.
const WELL_KNOWN_PATHS = [".well-known/agent-skills", ".well-known/skills"];

// Per-request ceiling. A domain that cannot answer in this long would time the
// CLI's own discovery out as well, so a slow domain is a miss rather than
// something to wait out.
const PROBE_TIMEOUT_MS = 8_000;

// How many domains to probe at once. The catalog has ~26; four at a time keeps
// the whole pass inside one action invocation without opening 26 sockets to
// strangers simultaneously.
const PROBE_CONCURRENCY = 4;

// Page size for the source scan. Large enough that the ~16k-row walk is ~16
// queries, small enough to stay well inside a query's read limit.
const SOURCE_SCAN_PAGE = 1_000;

/**
 * One page of the well-known-source walk.
 *
 * There is no index that isolates well-known rows — they are just sources whose
 * owner segment has a dot — so this pages the whole summaries table. That is
 * the reason the job is weekly; see the module header.
 */
export const listWellKnownSourcePage = internalQuery({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({
    sources: v.array(v.string()),
    nextCursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("skillSummaries")
      .withIndex("by_source_skillId")
      .paginate({ numItems: SOURCE_SCAN_PAGE, cursor: cursor ?? null });

    const sources = new Set<string>();
    for (const row of page.page) {
      if (row.isDelisted) continue;
      if (isGitHubSource(row.source)) continue;
      sources.add(row.source);
    }

    return {
      sources: [...sources],
      nextCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

/** Replace the whole table with this run's results. */
export const applyWellKnownIndexes = internalMutation({
  args: {
    results: v.array(
      v.object({
        source: v.string(),
        indexUrl: v.union(v.string(), v.null()),
        skillNames: v.array(v.string()),
      }),
    ),
  },
  returns: v.object({ written: v.number(), removed: v.number() }),
  handler: async (ctx, { results }) => {
    const checkedAt = Date.now();
    const keep = new Set(results.map((r) => r.source));

    for (const result of results) {
      const existing = await ctx.db
        .query("wellKnownIndexes")
        .withIndex("by_source", (q) => q.eq("source", result.source))
        .unique();
      const fields = {
        source: result.source,
        indexUrl: result.indexUrl,
        skillNames: result.skillNames,
        checkedAt,
      };
      if (existing) await ctx.db.patch(existing._id, fields);
      else await ctx.db.insert("wellKnownIndexes", fields);
    }

    // A domain whose last skill was delisted has left the catalog. Dropping its
    // row keeps this table readable as "the well-known sources that exist",
    // which is how the source count below and any later panel will read it.
    let removed = 0;
    for (const row of await ctx.db.query("wellKnownIndexes").collect()) {
      if (keep.has(row.source)) continue;
      await ctx.db.delete(row._id);
      removed++;
    }

    return { written: results.length, removed };
  },
});

/**
 * Fetch one domain's index, trying both well-known paths at the root.
 *
 * Deliberately strict about what counts as an answer: a 200 that isn't JSON, or
 * JSON without a `skills` array, is a miss. Both happen in the real catalog —
 * modelscope.cn serves its SPA's HTML for any path and skills.volces.com serves
 * a JSON error envelope, and both return 200 doing it. A parser that only
 * checked the status code recorded them as installable.
 */
async function probeSource(
  source: string,
): Promise<{ indexUrl: string | null; skillNames: string[] }> {
  for (const path of WELL_KNOWN_PATHS) {
    const indexUrl = `https://${source}/${path}/index.json`;
    try {
      const res = await fetch(indexUrl, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        headers: { Accept: "application/json", "User-Agent": "SkillBundle" },
      });
      if (!res.ok) continue;
      const body: unknown = await res.json();
      if (typeof body !== "object" || body === null) continue;
      const skills = (body as { skills?: unknown }).skills;
      if (!Array.isArray(skills)) continue;

      const skillNames = skills
        .map((entry) =>
          typeof entry === "object" && entry !== null
            ? (entry as { name?: unknown }).name
            : undefined,
        )
        .filter((name): name is string => typeof name === "string");
      if (skillNames.length === 0) continue;

      return { indexUrl, skillNames };
    } catch {
      // Timeout, DNS failure, TLS error, unparseable body — same answer to all.
      continue;
    }
  }
  return { indexUrl: null, skillNames: [] };
}

export const refreshWellKnownIndexes = internalAction({
  args: {},
  returns: v.object({
    sources: v.number(),
    withIndex: v.number(),
    removed: v.number(),
  }),
  handler: async (
    ctx,
  ): Promise<{ sources: number; withIndex: number; removed: number }> => {
    const sources = new Set<string>();
    let cursor: string | undefined = undefined;
    for (;;) {
      const page: {
        sources: string[];
        nextCursor: string | null;
        isDone: boolean;
      } = await ctx.runQuery(internal.wellKnown.listWellKnownSourcePage, {
        cursor,
      });
      for (const source of page.sources) sources.add(source);
      if (page.isDone || page.nextCursor === null) break;
      cursor = page.nextCursor;
    }

    const pending = [...sources];
    const results: {
      source: string;
      indexUrl: string | null;
      skillNames: string[];
    }[] = [];
    // A fixed pool pulling off one shared list, rather than fixed chunks: a
    // chunk waits on its slowest domain before the next one starts, and a
    // domain burning the whole timeout is the common case here, not the rare
    // one.
    await Promise.all(
      Array.from({ length: PROBE_CONCURRENCY }, async () => {
        for (;;) {
          const source = pending.pop();
          if (source === undefined) return;
          results.push({ source, ...(await probeSource(source)) });
        }
      }),
    );

    const { removed } = await ctx.runMutation(
      internal.wellKnown.applyWellKnownIndexes,
      { results },
    );

    return {
      sources: results.length,
      withIndex: results.filter((r) => r.indexUrl !== null).length,
      removed,
    };
  },
});

/**
 * The skill names each well-known source's root index advertises, for the
 * callers that build install commands. A source is absent from the result when
 * it serves no root index or has never been checked, and absent means "show no
 * command" — every reader treats it that way.
 *
 * Public because the bundle page and the quick-look sheet are client islands
 * and read it over the websocket; the site pages read it through a `'use cache'`
 * loader on the server. GitHub sources are dropped rather than rejected: the
 * bundle page passes whatever a bundle holds, and mixed bundles are normal.
 */
export const wellKnownSkillNames = query({
  args: { sources: v.array(v.string()) },
  returns: v.record(v.string(), v.array(v.string())),
  handler: async (ctx, { sources }) => {
    const out: Record<string, string[]> = {};
    // Bounded so a crafted argument can't turn one websocket message into an
    // unbounded fan-out of indexed reads. The whole catalog holds ~26
    // well-known sources, and a bundle can hold far fewer distinct ones.
    for (const source of [...new Set(sources)].slice(0, 50)) {
      if (isGitHubSource(source)) continue;
      const row = await ctx.db
        .query("wellKnownIndexes")
        .withIndex("by_source", (q) => q.eq("source", source))
        .unique();
      if (row && row.indexUrl !== null) out[source] = row.skillNames;
    }
    return out;
  },
});
