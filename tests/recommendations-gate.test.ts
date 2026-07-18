/**
 * Tests for the Pro gate inside convex/recommendations.ts `analyzeRepo`.
 *
 * Repo match is Pro-gated server-side, with a free demo-repo bypass and a
 * case-normalization step the source comments call "the security-relevant
 * spot" (convex/recommendations.ts:284-289). These tests exercise the gate
 * itself, not the downstream GitHub/embedding pipeline — fetch is stubbed
 * to reject so anything that slips past the gate fails fast and offline.
 *
 * Note: under convex-test the Polar component isn't registered, so
 * `getUserPlan` always resolves "free" (see convex/lib/plans.ts —
 * `polar.getCurrentSubscription` is wrapped in try/catch → "free"). The Pro
 * pass-through therefore can't be exercised end-to-end here; it's covered
 * at the predicate level in tests/repo-match.test.ts
 * (`isRepoMatchAllowed` with `canAutoDetect: true`).
 */
import { vi, test, expect, describe, beforeEach, afterEach } from "vitest";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import { makeTest } from "./_setup";
import { PRO_REQUIRED } from "../lib/repo-match";

type TestHandle = ReturnType<typeof makeTest>;

async function seedUser(t: TestHandle, externalId = "user-1") {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      name: "Test User",
      email: `${externalId}@example.com`,
      externalId,
    });
  });
}

async function expectProRequired(promise: Promise<unknown>) {
  await promise.then(
    () => {
      throw new Error("expected analyzeRepo to reject");
    },
    (err: unknown) => {
      expect(err).toBeInstanceOf(ConvexError);
      expect((err as ConvexError<{ code: string }>).data).toMatchObject({
        code: PRO_REQUIRED,
      });
    },
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("network disabled in test")),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("analyzeRepo — Pro gate", () => {
  test("signed-out + non-demo repo → PRO_REQUIRED", async () => {
    const t = makeTest();
    await expectProRequired(
      t.action(api.recommendations.analyzeRepo, {
        repoUrl: "https://github.com/vercel/next.js",
      }),
    );
  });

  test("authed free user + non-demo repo → PRO_REQUIRED", async () => {
    const t = makeTest();
    await seedUser(t, "user-1");
    const asUser = t.withIdentity({ subject: "user-1" });
    await expectProRequired(
      asUser.action(api.recommendations.analyzeRepo, {
        repoUrl: "https://github.com/vercel/next.js",
      }),
    );
  });

  test("demo repo bypasses the gate (signed out)", async () => {
    const t = makeTest();
    let proRequired = false;
    try {
      const result = await t.action(api.recommendations.analyzeRepo, {
        repoUrl: "https://github.com/shadcn-ui/ui",
      });
      // Got past the gate; downstream network is stubbed so we expect an
      // error field rather than a full success.
      expect(result).toHaveProperty("error");
    } catch (err) {
      if (
        err instanceof ConvexError &&
        (err.data as { code?: string } | undefined)?.code === PRO_REQUIRED
      ) {
        proRequired = true;
      }
      // Any other rejection (e.g. the stubbed network failure) means it got
      // past the gate — that's what we're asserting.
    }
    expect(proRequired).toBe(false);
  });

  test("demo repo, hostile casing, bypasses the gate (case-normalization guard)", async () => {
    const t = makeTest();
    let proRequired = false;
    try {
      const result = await t.action(api.recommendations.analyzeRepo, {
        repoUrl: "https://github.com/ShAdCn-Ui/Ui",
      });
      expect(result).toHaveProperty("error");
    } catch (err) {
      if (
        err instanceof ConvexError &&
        (err.data as { code?: string } | undefined)?.code === PRO_REQUIRED
      ) {
        proRequired = true;
      }
    }
    expect(proRequired).toBe(false);
  });

  test("invalid URL short-circuits before the gate", async () => {
    const t = makeTest();
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
