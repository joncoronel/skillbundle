/**
 * convex/users.ts: what the Clerk webhook is allowed to store, and what
 * deleting an account takes with it.
 */
import { test, expect, describe } from "vitest";
import type { UserJSON } from "@clerk/backend";
import { internal } from "../convex/_generated/api";
import { verifiedPrimaryEmail } from "../convex/users";
import { makeTest } from "./_setup";

function clerkUser(
  emails: Array<{ id: string; address: string; verified: boolean }>,
  primaryId: string | null,
): UserJSON {
  return {
    id: "user_clerk",
    first_name: "Ada",
    last_name: "Lovelace",
    image_url: "https://img.example/ada.png",
    primary_email_address_id: primaryId,
    email_addresses: emails.map((e) => ({
      id: e.id,
      email_address: e.address,
      verification: { status: e.verified ? "verified" : "unverified" },
    })),
  } as unknown as UserJSON;
}

describe("verifiedPrimaryEmail", () => {
  test("returns the primary address when it is verified", () => {
    expect(
      verifiedPrimaryEmail(
        clerkUser(
          [{ id: "e1", address: "ada@example.com", verified: true }],
          "e1",
        ),
      ),
    ).toBe("ada@example.com");
  });

  test("returns nothing when the primary address is unverified", () => {
    expect(
      verifiedPrimaryEmail(
        clerkUser(
          [{ id: "e1", address: "victim@example.com", verified: false }],
          "e1",
        ),
      ),
    ).toBeUndefined();
  });

  test("never falls back to a non-primary address", () => {
    expect(
      verifiedPrimaryEmail(
        clerkUser(
          [
            { id: "e1", address: "victim@example.com", verified: false },
            { id: "e2", address: "other@example.com", verified: true },
          ],
          null,
        ),
      ),
    ).toBeUndefined();
  });
});

test("deleting an account deletes its bundles and leaves other users' alone", async () => {
  const t = makeTest();
  const [gone, kept] = await t.run(async (ctx) => {
    const gone = await ctx.db.insert("users", {
      name: "Gone",
      externalId: "user_gone",
    });
    const kept = await ctx.db.insert("users", {
      name: "Kept",
      externalId: "user_kept",
    });
    for (const [userId, urlId] of [
      [gone, "gone-1"],
      [gone, "gone-2"],
      [kept, "kept-1"],
    ] as const) {
      await ctx.db.insert("bundles", {
        name: urlId,
        urlId,
        userId,
        isPublic: true,
        skills: [],
        createdAt: 0,
        updatedAt: 0,
      });
    }
    return [gone, kept];
  });

  await t.mutation(internal.users.deleteFromClerk, {
    clerkUserId: "user_gone",
  });

  await t.run(async (ctx) => {
    expect(await ctx.db.get(gone)).toBeNull();
    const remaining = await ctx.db.query("bundles").collect();
    expect(remaining.map((b) => b.urlId)).toEqual(["kept-1"]);
    expect(remaining[0].userId).toBe(kept);
  });
});
