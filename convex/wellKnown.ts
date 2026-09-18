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
 * most of the catalog — measured against production Sep 2026: 20 of 26 domains
 * answer at one of BASE_PATHS, covering 128 of 161 well-known skills. The other
 * six stay silent, which is the point: bun.sh's index is gone entirely and
 * modelscope.cn serves its SPA at every path, so any command we printed for
 * them would fail.
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

// Where on the domain to look, in order. The root is where most publishers put
// it, but the CLI accepts any base path and several sources use one: skills.sh
// installs mintlify.com from `https://mintlify.com/docs`, and its index really
// does live there. We cannot read their base path from anywhere (their API
// returns `installUrl: null` for well-known skills), so the only way to find it
// is to look. Measured Sep 2026, these two recover four domains and 19 skills;
// `doc` and `ai` recover none.
//
// A fixed list, never a value from a response: the chosen base is interpolated
// into a copyable shell command, so it has to come from this file.
const BASE_PATHS = ["", "docs", "skills"];

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

// Caps on what a third party's index can put in our row. The largest real one
// holds 28 names; these exist so a huge or hostile `index.json` cannot push a
// document past Convex's size limit and fail the write.
const MAX_INDEX_SKILLS = 500;
const MAX_SKILL_NAME_LENGTH = 200;

// Results per mutation. One call for the whole run meant a single rejected
// write discarded every other domain's fresh result.
const WRITE_BATCH = 10;

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

/**
 * Write one batch of probe results.
 *
 * `status: "error"` means the probe never got an answer (DNS, TLS, timeout). It
 * leaves an existing row alone, because overwriting it with an empty index
 * would delete every install command for that domain until the next weekly run
 * over one blip. Only "empty" — the domain answered, with nothing usable — is
 * allowed to clear a row.
 */
export const applyWellKnownIndexes = internalMutation({
  args: {
    results: v.array(
      v.object({
        source: v.string(),
        status: v.union(
          v.literal("ok"),
          v.literal("empty"),
          v.literal("error"),
        ),
        baseUrl: v.union(v.string(), v.null()),
        indexUrl: v.union(v.string(), v.null()),
        skillNames: v.array(v.string()),
      }),
    ),
  },
  returns: v.object({ written: v.number(), kept: v.number() }),
  handler: async (ctx, { results }) => {
    const checkedAt = Date.now();
    let written = 0;
    let kept = 0;

    for (const result of results) {
      const existing = await ctx.db
        .query("wellKnownIndexes")
        .withIndex("by_source", (q) => q.eq("source", result.source))
        .unique();

      if (result.status === "error" && existing) {
        // `checkedAt` deliberately not bumped: a stale timestamp beside a live
        // index is what says "we have not reached this domain lately".
        kept++;
        continue;
      }

      const fields = {
        source: result.source,
        baseUrl: result.baseUrl ?? undefined,
        indexUrl: result.indexUrl,
        skillNames: result.skillNames,
        checkedAt,
      };
      if (existing) await ctx.db.patch(existing._id, fields);
      else await ctx.db.insert("wellKnownIndexes", fields);
      written++;
    }

    return { written, kept };
  },
});

/**
 * Drop rows for sources that are no longer in the catalog, so the table stays
 * readable as "the well-known sources that exist". Separate from the writes
 * above because it runs once per run, after every batch has landed.
 */
export const pruneWellKnownIndexes = internalMutation({
  args: { sources: v.array(v.string()) },
  returns: v.number(),
  handler: async (ctx, { sources }) => {
    const keep = new Set(sources);
    let removed = 0;
    for (const row of await ctx.db.query("wellKnownIndexes").collect()) {
      if (keep.has(row.source)) continue;
      await ctx.db.delete(row._id);
      removed++;
    }
    return removed;
  },
});

type ProbeResult = {
  source: string;
  status: "ok" | "empty" | "error";
  // What `npx skills add` takes for this source, built from `source` and one
  // of BASE_PATHS. The command is built from THIS, never from `indexUrl`.
  baseUrl: string | null;
  // The URL that answered, after redirects. Diagnostics only: a third party
  // controls it, so nothing user-facing may be derived from it.
  indexUrl: string | null;
  skillNames: string[];
};

/**
 * Is this source safe to interpolate into the probe URL?
 *
 * `isGitHubSource` is shape-only and says so in its own header: anything that
 * builds a URL out of a `source` has to validate separately. Catalog sources
 * come from the skills.sh API, so a value carrying `@`, `:`, `/`, `?` or `#`
 * would retarget the host or the path. Parsing the result back and demanding
 * the host equal the source is the check that cannot be reasoned around.
 */
function isProbeableHost(source: string): boolean {
  if (!/^[a-z0-9.-]+$/i.test(source)) return false;
  if (!source.includes(".")) return false;
  try {
    return new URL(`https://${source}/`).host === source.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Find one domain's index, trying each base in BASE_PATHS and both well-known
 * paths under it. First to answer with a parseable index wins.
 *
 * Deliberately strict about what counts as an answer: a 200 that isn't JSON, or
 * JSON without a `skills` array, is a miss. Both happen in the real catalog —
 * modelscope.cn serves its SPA's HTML for any path and skills.volces.com serves
 * a JSON error envelope, and both return 200 doing it. A parser that only
 * checked the status code recorded them as installable.
 *
 * Redirects are followed. Measured Sep 2026: evlog.dev answers 307 to
 * www.evlog.dev, so refusing them would drop a source that works, and the CLI
 * follows them too.
 */
async function probeSource(source: string): Promise<ProbeResult> {
  const miss = (status: "empty" | "error"): ProbeResult => ({
    source,
    status,
    baseUrl: null,
    indexUrl: null,
    skillNames: [],
  });

  if (!isProbeableHost(source)) return miss("empty");

  // Only "we never got an answer" should preserve a stored index, so one
  // unreachable candidate is enough to make the whole probe inconclusive.
  let unreachable = false;

  for (const base of BASE_PATHS) {
    const baseUrl = base ? `https://${source}/${base}` : `https://${source}`;
    for (const path of WELL_KNOWN_PATHS) {
      const indexUrl = `${baseUrl}/${path}/index.json`;

      // The request, and only the request. A throw here is a timeout, a DNS or
      // TLS failure: we never reached the domain, so nothing it said before can
      // be contradicted.
      let res: Response;
      try {
        res = await fetch(indexUrl, {
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
          headers: { Accept: "application/json", "User-Agent": "SkillBundle" },
        });
      } catch {
        unreachable = true;
        continue;
      }

      if (!res.ok) {
        // 404 is a real answer: this domain does not publish here. A 5xx, a 429,
        // or the 403 a CDN hands a datacenter IP with a non-browser User-Agent
        // is not, and treating those as "publishes nothing" wipes the domain's
        // commands until the next run.
        if (res.status >= 500 || res.status === 429 || res.status === 403) {
          unreachable = true;
        }
        continue;
      }

      // Everything past here is the domain answering with something we can't
      // use, which IS an answer. `continue` without setting `unreachable`, so a
      // domain that starts serving its SPA at this path clears its stale row
      // rather than keeping it forever.
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        continue;
      }
      if (typeof body !== "object" || body === null) continue;
      const skills = (body as { skills?: unknown }).skills;
      if (!Array.isArray(skills)) continue;

      const skillNames = skills
        .slice(0, MAX_INDEX_SKILLS)
        .map((entry) =>
          typeof entry === "object" && entry !== null
            ? (entry as { name?: unknown }).name
            : undefined,
        )
        .filter(
          (name): name is string =>
            typeof name === "string" &&
            name.length > 0 &&
            name.length <= MAX_SKILL_NAME_LENGTH,
        );
      if (skillNames.length === 0) continue;

      // `baseUrl` is ours; `indexUrl` records where the bytes actually came
      // from, which differs after a redirect and is diagnostics only.
      return {
        source,
        status: "ok",
        baseUrl,
        indexUrl: res.url || indexUrl,
        skillNames,
      };
    }
  }
  return miss(unreachable ? "error" : "empty");
}

export const refreshWellKnownIndexes = internalAction({
  args: {},
  returns: v.object({
    sources: v.number(),
    withIndex: v.number(),
    unreachable: v.number(),
    removed: v.number(),
  }),
  handler: async (
    ctx,
  ): Promise<{
    sources: number;
    withIndex: number;
    unreachable: number;
    removed: number;
  }> => {
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

    // A fixed pool pulling off one shared list, rather than fixed chunks: a
    // chunk waits on its slowest domain before the next one starts, and a
    // domain burning the whole timeout is the common case here, not the rare
    // one.
    const probeAll = async (list: string[]): Promise<ProbeResult[]> => {
      const queue = [...list];
      const out: ProbeResult[] = [];
      await Promise.all(
        Array.from({ length: PROBE_CONCURRENCY }, async () => {
          for (;;) {
            const source = queue.pop();
            if (source === undefined) return;
            out.push(await probeSource(source));
          }
        }),
      );
      return out;
    };

    const results = await probeAll([...sources]);

    // One retry for the domains that never answered, because this job runs
    // weekly and nobody watches it: a domain that flakes on Sunday would
    // otherwise stay dark for seven days. Measured against production Sep 2026,
    // a second pass recovered apifox.com and cdn-cmm-ai-open.chanmama.com both
    // times they were asked, so the flake is transient and one retry clears it.
    // Only "error" retries; "empty" is a real answer and re-asking it would
    // just double the requests.
    const unreachable = results.filter((r) => r.status === "error");
    if (unreachable.length > 0) {
      const retried = new Map(
        (await probeAll(unreachable.map((r) => r.source))).map((r) => [
          r.source,
          r,
        ]),
      );
      for (let i = 0; i < results.length; i++) {
        const second = retried.get(results[i].source);
        if (second && second.status !== "error") results[i] = second;
      }
    }

    for (let i = 0; i < results.length; i += WRITE_BATCH) {
      await ctx.runMutation(internal.wellKnown.applyWellKnownIndexes, {
        results: results.slice(i, i + WRITE_BATCH),
      });
    }
    const removed: number = await ctx.runMutation(
      internal.wellKnown.pruneWellKnownIndexes,
      { sources: [...sources] },
    );

    return {
      sources: results.length,
      withIndex: results.filter((r) => r.status === "ok").length,
      // Probed but never answered. Their stored rows were left as they were,
      // so a non-zero count here is not the same as a loss of coverage.
      unreachable: results.filter((r) => r.status === "error").length,
      removed,
    };
  },
});

/**
 * What each well-known source can be installed from: the base `npx skills add`
 * takes, and the skill names its index advertises. A source is absent when it
 * serves no index or has never been checked, and absent means "show no
 * command" — every reader treats it that way.
 *
 * Public because the bundle page and the quick-look sheet are client islands
 * and read it over the websocket; the site pages read it through a `'use cache'`
 * loader on the server. GitHub sources are dropped rather than rejected: the
 * bundle page passes whatever a bundle holds, and mixed bundles are normal.
 */
export const wellKnownSkillNames = query({
  args: { sources: v.array(v.string()) },
  returns: v.record(
    v.string(),
    v.object({ base: v.string(), skills: v.array(v.string()) }),
  ),
  handler: async (ctx, { sources }) => {
    const out: Record<string, { base: string; skills: string[] }> = {};
    // Bounded so a crafted argument can't turn one websocket message into an
    // unbounded fan-out of indexed reads. The whole catalog holds ~26
    // well-known sources, and a bundle can hold far fewer distinct ones.
    for (const source of [...new Set(sources)].slice(0, 50)) {
      if (isGitHubSource(source)) continue;
      const row = await ctx.db
        .query("wellKnownIndexes")
        .withIndex("by_source", (q) => q.eq("source", source))
        .unique();
      if (row?.baseUrl)
        out[source] = { base: row.baseUrl, skills: row.skillNames };
    }
    return out;
  },
});
