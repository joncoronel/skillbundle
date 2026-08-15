import path from "node:path";
import { test as setup } from "@playwright/test";
import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { createClerkClient } from "@clerk/backend";

/**
 * Playwright *setup project*: signs in once and saves the browser state so the
 * authenticated specs don't each pay a full sign-in. Wired via `dependencies`
 * in playwright.config.ts.
 *
 * How the sign-in works without a real inbox: Clerk development instances treat
 * any address containing `+clerk_test` as a test identity, with a fixed
 * verification code. `clerk.signIn({ strategy: 'email_code' })` exploits that,
 * so there's no mailbox to poll and no password to store.
 *
 * `clerkSetup()` separately fetches a Testing Token from Clerk's backend API,
 * which is what stops bot protection from blocking an automated sign-in.
 *
 * The user is created on demand rather than being a manual prerequisite, so a
 * fresh Clerk dev instance (or a wiped one) still works with no setup steps.
 * This is find-or-create and therefore safe to re-run.
 */

export const STORAGE_STATE = path.join(
  process.cwd(),
  "playwright/.clerk/user.json",
);

// Deliberately not a real mailbox. The `+clerk_test` marker is what makes Clerk
// accept the fixed verification code instead of sending mail.
const TEST_EMAIL =
  process.env.E2E_CLERK_TEST_EMAIL ?? "e2e+clerk_test@skillbundle.dev";

setup("authenticate", async ({ page }) => {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  setup.skip(
    !secretKey || !publishableKey,
    "Clerk keys not set — skipping authenticated e2e",
  );

  // Guard rail: these helpers refuse production keys, but fail loudly here
  // rather than halfway through creating a user.
  if (!secretKey!.startsWith("sk_test_")) {
    throw new Error(
      "Refusing to run authenticated e2e against a non-development Clerk instance " +
        "(CLERK_SECRET_KEY is not sk_test_*).",
    );
  }

  await clerkSetup({ publishableKey });

  // Find-or-create the test user via the backend API.
  const clerkClient = createClerkClient({ secretKey });
  const existing = await clerkClient.users.getUserList({
    emailAddress: [TEST_EMAIL],
  });
  if (existing.totalCount === 0) {
    await clerkClient.users.createUser({
      emailAddress: [TEST_EMAIL],
      skipPasswordRequirement: true,
    });
  }

  // clerk.signIn requires Clerk to be loaded, so land on a public page first.
  await page.goto("/");
  await clerk.signIn({
    page,
    signInParams: { strategy: "email_code", identifier: TEST_EMAIL },
  });

  // Prove the session actually took before persisting it — otherwise every
  // downstream spec fails with a confusing redirect instead of pointing here.
  await page.goto("/dashboard");
  await page.waitForURL((url) => url.pathname === "/dashboard");

  await page.context().storageState({ path: STORAGE_STATE });
});
