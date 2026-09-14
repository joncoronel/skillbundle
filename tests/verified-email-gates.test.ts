/**
 * The two places a caller's email grants something: admin access
 * (`devStats.isAdmin` / `assertAdmin`) and billing identity
 * (`polar.getUserInfo`, whose email Polar uses to match an existing customer).
 * Both must read the email from the token and require `emailVerified`.
 */
import { beforeAll, describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { makeTest } from "./_setup";

const ADMIN = "admin@example.com";

beforeAll(() => {
  // devStats.ts parses ADMIN_EMAILS when the module first loads, which
  // convex-test does lazily on the first function call in this file.
  process.env.ADMIN_EMAILS = ADMIN;
});

describe("isAdmin", () => {
  test("a listed email counts only when the token says it is verified", async () => {
    const t = makeTest();
    const as = (claims: Record<string, unknown>) =>
      t.withIdentity({ subject: "user_admin", email: ADMIN, ...claims });

    expect(await as({ emailVerified: true }).query(api.devStats.isAdmin)).toBe(
      true,
    );
    expect(await as({ emailVerified: false }).query(api.devStats.isAdmin)).toBe(
      false,
    );
    expect(await as({}).query(api.devStats.isAdmin)).toBe(false);
  });

  test("an unlisted verified email is not an admin", async () => {
    const t = makeTest();
    const result = await t
      .withIdentity({
        subject: "user_other",
        email: "other@example.com",
        emailVerified: true,
      })
      .query(api.devStats.isAdmin);
    expect(result).toBe(false);
  });
});

describe("polar.getUserInfo", () => {
  async function setup(storedEmail?: string) {
    const t = makeTest();
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", {
        name: "Billing User",
        externalId: "user_billing",
        ...(storedEmail && { email: storedEmail }),
      }),
    );
    return { t, userId };
  }

  test("bills with the verified token email, not the stored one", async () => {
    // The stored row holds a stale, unverified fallback from before
    // verifiedPrimaryEmail; it must not reach Polar.
    const { t, userId } = await setup("someone-else@example.com");
    const info = await t
      .withIdentity({
        subject: "user_billing",
        email: "me@example.com",
        emailVerified: true,
      })
      .query(api.polar.getUserInfo);
    expect(info).toEqual({ userId, email: "me@example.com" });
  });

  test("refuses when the token email is not verified", async () => {
    const { t } = await setup("me@example.com");
    await expect(
      t
        .withIdentity({
          subject: "user_billing",
          email: "me@example.com",
          emailVerified: false,
        })
        .query(api.polar.getUserInfo),
    ).rejects.toThrow(/Verify your email/);
  });
});
