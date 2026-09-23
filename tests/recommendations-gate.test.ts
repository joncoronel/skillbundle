/**
 * Tests for the repo-match gates in convex/recommendations.ts: who may run
 * `analyzeRepo`, the free account's monthly allowance (convex/repoMatchQuota.ts),
 * and the signed-out `analyzeRepoAnonymous` entry point with its per-visitor
 * allowance. These exercise the gates, not the downstream GitHub/embedding
 * pipeline: fetch is stubbed to reject, so a run that gets past a gate comes
 * back as a fetch-error result, fast and offline.
 *
 * Note: under convex-test the Polar component isn't registered, so
 * `getUserPlan` always resolves "free" (see convex/lib/plans.ts —
 * `polar.getCurrentSubscription` is wrapped in try/catch → "free"). The Pro
 * pass-through therefore can't be exercised end-to-end here; it's covered
 * at the predicate level in tests/repo-match.test.ts (`repoMatchMeter` with
 * `canAutoDetect: true`).
 */
import { vi, test, expect, describe, beforeEach, afterEach } from "vitest";
import { ConvexError } from "convex/values";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { api, internal } from "../convex/_generated/api";
import { makeTest } from "./_setup";
import { currentMonth } from "../lib/repo-match";
import {
  ANON_DAILY_ANALYSES,
  ANON_LIMIT,
  FREE_LIMIT,
  FREE_MONTHLY_REPOS,
  SIGN_IN_REQUIRED,
} from "../lib/repo-match";

type TestHandle = ReturnType<typeof makeTest>;

const SECRET = "test-repo-match-secret";
const VISITOR = "a".repeat(64);
const FETCH_ERROR = "Could not fetch repository details";

function setup() {
  const t = makeTest();
  rateLimiterTest.register(t);
  return t;
}

async function seedUser(t: TestHandle, externalId = "user-1") {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      name: "Test User",
      email: `${externalId}@example.com`,
      externalId,
    });
  });
}

async function seedQuota(
  t: TestHandle,
  subject: string,
  month: string,
  repos: string[],
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("repoMatchQuota", { subject, month, repos });
  });
}

async function quotaRow(t: TestHandle, subject: string) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("repoMatchQuota")
      .withIndex("by_subject", (q) => q.eq("subject", subject))
      .unique(),
  );
}

/** Five distinct repos that aren't the demo. */
const FIVE = Array.from({ length: FREE_MONTHLY_REPOS }, (_, i) => `o/r${i}`);

/** The ConvexError code a call refused with, or null when it resolved. */
async function refusalCode(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError);
    return (err as ConvexError<{ code: string }>).data.code;
  }
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("network disabled in test")),
  );
  vi.stubEnv("REPO_MATCH_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("analyzeRepo — who may run it", () => {
  test("signed-out + non-demo repo → SIGN_IN_REQUIRED", async () => {
    const t = setup();
    expect(
      await refusalCode(
        t.action(api.recommendations.analyzeRepo, {
          repoUrl: "https://github.com/vercel/next.js",
        }),
      ),
    ).toBe(SIGN_IN_REQUIRED);
  });

  test("authed free user + non-demo repo gets past the gate", async () => {
    const t = setup();
    await seedUser(t, "user-1");
    const result = await t
      .withIdentity({ subject: "user-1" })
      .action(api.recommendations.analyzeRepo, {
        repoUrl: "https://github.com/vercel/next.js",
      });
    expect(result.error).toBe(FETCH_ERROR);
  });

  test("demo repo bypasses the gate (signed out)", async () => {
    const t = setup();
    const result = await t.action(api.recommendations.analyzeRepo, {
      repoUrl: "https://github.com/shadcn-ui/ui",
    });
    expect(result).toHaveProperty("error");
  });

  test("demo repo, hostile casing, bypasses the gate (case-normalization guard)", async () => {
    const t = setup();
    const result = await t.action(api.recommendations.analyzeRepo, {
      repoUrl: "https://github.com/ShAdCn-Ui/Ui",
    });
    expect(result).toHaveProperty("error");
  });

  test("invalid URL short-circuits before the gate", async () => {
    const t = setup();
    const result = await t.action(api.recommendations.analyzeRepo, {
      repoUrl: "not a repo",
    });
    expect(result).toEqual({
      error: "Invalid GitHub URL",
      repoName: "",
      fingerprint: null,
      recommendations: [],
    });
  });
});

describe("analyzeRepo — free monthly allowance", () => {
  test("a 6th distinct repo in a month is refused", async () => {
    const t = setup();
    await seedUser(t, "user-1");
    await seedQuota(t, "user-1", currentMonth(), FIVE);
    expect(
      await refusalCode(
        t
          .withIdentity({ subject: "user-1" })
          .action(api.recommendations.analyzeRepo, {
            repoUrl: "https://github.com/vercel/next.js",
          }),
      ),
    ).toBe(FREE_LIMIT);
  });

  test("a free account's misses are bounded by its daily attempt budget", async () => {
    const t = setup();
    await seedUser(t, "user-1");
    for (let i = 0; i < 20; i++) {
      await t.mutation(internal.rateLimits.enforce, {
        checks: [{ name: "repoAnalysisDaily", key: "user-1" }],
      });
    }
    expect(
      await refusalCode(
        t
          .withIdentity({ subject: "user-1" })
          .action(api.recommendations.analyzeRepo, {
            repoUrl: "https://github.com/vercel/next.js",
          }),
      ),
    ).toBe("rate_limited");
    // Refused before any work, so the monthly slot it claimed goes back.
    expect((await quotaRow(t, "user-1"))?.repos).toEqual([]);
  });

  test("re-running a repo already counted this month is allowed, and keeps its slot", async () => {
    const t = setup();
    await seedUser(t, "user-1");
    const repos = [...FIVE.slice(1), "vercel/next.js"];
    await seedQuota(t, "user-1", currentMonth(), repos);
    // Different casing, same repo.
    const result = await t
      .withIdentity({ subject: "user-1" })
      .action(api.recommendations.analyzeRepo, {
        repoUrl: "https://github.com/Vercel/Next.js",
      });
    expect(result.error).toBe(FETCH_ERROR);
    // The failed re-run must not refund a slot it didn't take.
    expect((await quotaRow(t, "user-1"))?.repos).toEqual(repos);
  });

  test("a new month starts from zero", async () => {
    const t = setup();
    await seedUser(t, "user-1");
    await seedQuota(t, "user-1", "2000-01", FIVE);
    const code = await refusalCode(
      t
        .withIdentity({ subject: "user-1" })
        .action(api.recommendations.analyzeRepo, {
          repoUrl: "https://github.com/vercel/next.js",
        }),
    );
    expect(code).toBeNull();
    // The run failed (network stubbed), so its slot was refunded, leaving the
    // row reset to this month and empty.
    const row = await quotaRow(t, "user-1");
    expect(row?.month).toBe(currentMonth());
    expect(row?.repos).toEqual([]);
  });

  test("demo repos never count", async () => {
    const t = setup();
    await seedUser(t, "user-1");
    await seedQuota(t, "user-1", currentMonth(), FIVE);
    const code = await refusalCode(
      t
        .withIdentity({ subject: "user-1" })
        .action(api.recommendations.analyzeRepo, {
          repoUrl: "https://github.com/shadcn-ui/ui",
        }),
    );
    expect(code).toBeNull();
  });

  test("claim counts distinct repos and refuses past the limit", async () => {
    const t = setup();
    for (const repoKey of FIVE) {
      expect(
        await t.mutation(internal.repoMatchQuota.claim, {
          subject: "user-1",
          repoKey,
        }),
      ).toBe(true);
    }
    // Already counted: allowed, not newly claimed.
    expect(
      await t.mutation(internal.repoMatchQuota.claim, {
        subject: "user-1",
        repoKey: FIVE[0],
      }),
    ).toBe(false);
    expect(
      await refusalCode(
        t.mutation(internal.repoMatchQuota.claim, {
          subject: "user-1",
          repoKey: "o/sixth",
        }),
      ),
    ).toBe(FREE_LIMIT);
  });

  test("myUsage reports this month for a free account, null signed out", async () => {
    const t = setup();
    await seedUser(t, "user-1");
    await seedQuota(t, "user-1", currentMonth(), ["o/r0", "o/r1"]);
    expect(
      await t
        .withIdentity({ subject: "user-1" })
        .query(api.repoMatchQuota.myUsage, {}),
    ).toEqual({
      used: 2,
      limit: FREE_MONTHLY_REPOS,
      repos: ["o/r0", "o/r1"],
      month: currentMonth(),
    });
    expect(await t.query(api.repoMatchQuota.myUsage, {})).toBeNull();
  });
});

describe("analyzeRepoAnonymous", () => {
  test("rejects a bad secret", async () => {
    const t = setup();
    expect(
      await refusalCode(
        t.action(api.recommendations.analyzeRepoAnonymous, {
          repoUrl: "https://github.com/vercel/next.js",
          visitorKey: VISITOR,
          secret: "wrong",
        }),
      ),
    ).toBe("unauthorized");
  });

  test("rejects everything when the deployment has no secret set", async () => {
    vi.stubEnv("REPO_MATCH_SECRET", "");
    const t = setup();
    expect(
      await refusalCode(
        t.action(api.recommendations.analyzeRepoAnonymous, {
          repoUrl: "https://github.com/vercel/next.js",
          visitorKey: VISITOR,
          secret: "",
        }),
      ),
    ).toBe("unauthorized");
  });

  const runAnon = (t: TestHandle, visitorKey: string, i: number) =>
    t.action(api.recommendations.analyzeRepoAnonymous, {
      // A different uncached repo each time, so every run is fresh work.
      repoUrl: `https://github.com/o/r${i}`,
      visitorKey,
      secret: SECRET,
    });

  /** Spend `count` units of one limit for one key, as real runs would. */
  async function spend(
    t: TestHandle,
    name: "repoAnalysisAnonymous" | "repoAnalysisDaily",
    key: string,
    count: number,
  ) {
    for (let i = 0; i < count; i++) {
      await t.mutation(internal.rateLimits.enforce, {
        checks: [{ name, key }],
      });
    }
  }

  test("a spent allowance refuses before any GitHub call", async () => {
    const t = setup();
    await spend(t, "repoAnalysisAnonymous", VISITOR, ANON_DAILY_ANALYSES);
    expect(await refusalCode(runAnon(t, VISITOR, 0))).toBe(ANON_LIMIT);
    // Another visitor has their own allowance.
    expect(await refusalCode(runAnon(t, "b".repeat(64), 0))).toBeNull();
  });

  test("a miss doesn't spend the allowance", async () => {
    const t = setup();
    // Every run here is a fetch error (fetch is stubbed), so more misses than
    // the allowance holds all still get through to the pipeline.
    for (let i = 0; i <= ANON_DAILY_ANALYSES; i++) {
      const result = await runAnon(t, VISITOR, i);
      expect(result.error).toBe(FETCH_ERROR);
    }
  });

  test("the daily attempt budget bounds misses", async () => {
    const t = setup();
    await spend(t, "repoAnalysisDaily", `visitor:${VISITOR}`, 20);
    expect(await refusalCode(runAnon(t, VISITOR, 0))).toBe("rate_limited");
  });

  test("cache hits don't touch the allowance", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("githubTreeCache", {
        repo: "o/cached",
        branch: "main",
        etag: "etag",
        dependencyFilePaths: [],
        cachedAt: Date.now(),
      });
      await ctx.db.insert("repoFingerprintCache", {
        cacheKey: "o/cached",
        fingerprint: {
          packages: [],
          configFiles: [],
          languages: [],
          topics: [],
        },
        embedding: [],
        cachedAt: Date.now(),
        recommendations: [],
      });
    });
    for (let i = 0; i < ANON_DAILY_ANALYSES + 2; i++) {
      const result = await t.action(api.recommendations.analyzeRepoAnonymous, {
        repoUrl: "https://github.com/o/cached",
        visitorKey: VISITOR,
        secret: SECRET,
      });
      expect(result.error).toBeNull();
    }
  });
});
