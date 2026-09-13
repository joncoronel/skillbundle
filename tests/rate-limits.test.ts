/**
 * The rate limits in convex/rateLimits.ts, tested against the rule they are
 * built on: a limit catches scripts, never a person. So the tests check both
 * sides of it. Human-paced use on an uncapped (Pro) plan never trips anything,
 * and machine-paced use trips it quickly.
 */
import { vi, test, expect, afterEach, beforeEach } from "vitest";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { internal } from "../convex/_generated/api";
import { makeTest } from "./_setup";
import type { Id } from "../convex/_generated/dataModel";

beforeEach(() => {
  // Fake only Date so convex-test's internal async machinery is untouched.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-22T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const t = makeTest();
  rateLimiterTest.register(t);
  return t;
}

async function seedUser(
  t: ReturnType<typeof makeTest>,
  externalId: string,
): Promise<Id<"users">> {
  return await t.run((ctx) =>
    ctx.db.insert("users", { name: "Test User", externalId }),
  );
}

/**
 * Make up to `max` add calls `gapMs` apart, moving the clock forward from
 * wherever it is. Returns the 1-based index of the first refusal, or null.
 */
async function addUntilRefused(
  t: ReturnType<typeof makeTest>,
  args: { userId: Id<"users">; capped: boolean },
  max: number,
  gapMs: number,
): Promise<{ at: number; data: unknown } | null> {
  for (let i = 1; i <= max; i++) {
    try {
      await t.mutation(internal.rateLimits.enforceAddSkill, args);
    } catch (err) {
      return { at: i, data: (err as { data?: unknown }).data };
    }
    vi.setSystemTime(Date.now() + gapMs);
  }
  return null;
}

test("an uncapped (Pro) user adding every 4 seconds for 10 minutes is never limited", async () => {
  const t = setup();
  const userId = await seedUser(t, "user_pro");

  const refusal = await addUntilRefused(
    t,
    { userId, capped: false },
    150,
    4_000,
  );
  expect(refusal).toBeNull();
});

test("a capped (free) user at the same pace is stopped after about an hour's allowance", async () => {
  const t = setup();
  const userId = await seedUser(t, "user_free");

  const refusal = await addUntilRefused(
    t,
    { userId, capped: true },
    150,
    4_000,
  );
  // 60 up front, plus the one-a-minute refill over the four-odd minutes spent.
  expect(refusal?.at).toBeGreaterThan(60);
  expect(refusal?.at).toBeLessThanOrEqual(70);
  expect(refusal?.data).toMatchObject({ code: "rate_limited" });
});

test("a machine-speed burst is refused on any plan, then refills", async () => {
  const t = setup();
  const userId = await seedUser(t, "user_script");
  const args = { userId, capped: false };

  const refusal = await addUntilRefused(t, args, 50, 0);
  expect(refusal?.at).toBe(21);
  expect(refusal?.data).toMatchObject({
    code: "rate_limited",
    message: expect.stringContaining("Wait a minute"),
  });

  // 20 a minute refills one every 3 seconds.
  vi.setSystemTime(Date.now() + 3_000);
  await t.mutation(internal.rateLimits.enforceAddSkill, args);
});

test("limits are per user: one account at its limit doesn't affect another", async () => {
  const t = setup();
  const script = await seedUser(t, "user_script");
  const other = await seedUser(t, "user_other");

  expect(
    (await addUntilRefused(t, { userId: script, capped: false }, 50, 0))?.at,
  ).toBe(21);
  expect(
    await addUntilRefused(t, { userId: other, capped: false }, 20, 0),
  ).toBeNull();
});

test("a refusal rolls back the checks that passed before it", async () => {
  const t = setup();
  const userId = await seedUser(t, "user_rollback");

  // Use up the capped hourly allowance at a pace the per-minute limit absorbs.
  expect(
    await addUntilRefused(t, { userId, capped: true }, 150, 4_000),
  ).not.toBeNull();

  // 25 refused calls with no time passing: each passes the per-minute check,
  // then fails the hourly one. Without the rollback, the per-minute limit
  // would be spent by the twentieth of them.
  for (let i = 0; i < 25; i++) {
    await expect(
      t.mutation(internal.rateLimits.enforceAddSkill, { userId, capped: true }),
    ).rejects.toMatchObject({ data: { code: "rate_limited" } });
  }

  // The per-minute limit is still full.
  expect((await addUntilRefused(t, { userId, capped: false }, 50, 0))?.at).toBe(
    21,
  );
});
