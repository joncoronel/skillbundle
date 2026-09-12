import { describe, expect, it } from "vitest";
import proxySource from "../proxy.ts?raw";

// proxy.ts keeps two route lists that must agree: `isPrivateRoute` decides
// what `auth.protect()` guards, and `config.matcher` decides whether the proxy
// runs at all. A private route missing from the matcher is silently public,
// with no error and no failed build, so this is the only thing that catches it.
//
// Read as text rather than imported. `config.matcher` has to stay a literal
// that Next reads statically, so it can't be built from a shared constant, and
// importing the module would pull Clerk into the test runtime.

function listAfter(marker: string): string[] {
  const start = proxySource.indexOf(marker);
  expect(start, `\`${marker}\` not found in proxy.ts`).toBeGreaterThan(-1);
  const open = proxySource.indexOf("[", start);
  const close = proxySource.indexOf("]", open);
  return [...proxySource.slice(open, close).matchAll(/"([^"]+)"/g)].map(
    (m) => m[1],
  );
}

const matchers = listAfter("matcher:").map((p) => new RegExp(`^${p}$`));
const runsProxy = (path: string) => matchers.some((re) => re.test(path));

// `/dashboard(.*)` → `/dashboard`
const basePath = (pattern: string) => pattern.replace("(.*)", "");

describe("proxy.ts route lists", () => {
  it("reads both lists", () => {
    expect(matchers.length).toBeGreaterThan(0);
    expect(listAfter("const isPrivateRoute").length).toBeGreaterThan(0);
    expect(listAfter("const isAuthRoute").length).toBeGreaterThan(0);
  });

  it.each(listAfter("const isPrivateRoute"))(
    "runs the proxy on private route %s and everything beneath it",
    (pattern) => {
      expect(runsProxy(basePath(pattern))).toBe(true);
      expect(runsProxy(`${basePath(pattern)}/nested`)).toBe(true);
    },
  );

  it.each(listAfter("const isAuthRoute"))(
    "runs the proxy on auth route %s",
    (path) => {
      expect(runsProxy(path)).toBe(true);
    },
  );

  it("still runs the proxy on the OAuth callback", () => {
    expect(runsProxy("/sign-in/sso-callback")).toBe(true);
    expect(runsProxy("/sign-up/sso-callback")).toBe(true);
  });

  // The matcher used to cover every path, which cost ~574k invocations a day
  // (Sep 2026). These routes read auth on the client only.
  it.each(["/", "/official", "/privacy", "/vercel-labs/skills/find-skills"])(
    "does not run the proxy on public route %s",
    (path) => {
      expect(runsProxy(path)).toBe(false);
    },
  );
});
