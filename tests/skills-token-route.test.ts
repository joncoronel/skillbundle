// @vitest-environment node
//
// The rest of the suite runs in edge-runtime (see vitest.config.ts) because
// convex-test needs it. This route uses `node:crypto`'s timingSafeEqual and
// Buffer, which edge-runtime does not provide, so this file opts into node.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getTokenMock } = vi.hoisted(() => ({ getTokenMock: vi.fn() }));

vi.mock("@vercel/oidc", () => ({ getVercelOidcToken: getTokenMock }));

import { POST } from "../app/api/skills-token/route";

const SECRET = "test-secret-value";

/** Build a JWT-shaped string whose payload carries `exp` (seconds). */
function jwtWithExp(expSeconds: number | undefined): string {
  const payload = Buffer.from(
    JSON.stringify(
      expSeconds === undefined ? { sub: "x" } : { exp: expSeconds },
    ),
  ).toString("base64url");
  return `header.${payload}.signature`;
}

function post(secret?: string) {
  const headers: Record<string, string> = {};
  if (secret !== undefined) headers["x-skills-token-secret"] = secret;
  return new Request("http://localhost/api/skills-token", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  getTokenMock.mockReset();
  process.env.SKILLS_TOKEN_SECRET = SECRET;
});

/**
 * This route hands a bearer credential carrying our Vercel team and project
 * identity to a caller outside Vercel (the Convex backend), and it sits outside
 * Clerk's private-route list, so the shared secret is the entire gate. That, and
 * refusing to emit a token whose expiry Convex can't read, is what's worth
 * pinning here — minting itself is Vercel's job.
 */
describe("POST /api/skills-token", () => {
  describe("rejects", () => {
    it("a request with no secret header", async () => {
      const res = await POST(post());
      expect(res.status).toBe(401);
      expect(getTokenMock).not.toHaveBeenCalled();
    });

    it("a wrong secret of the same length", async () => {
      // Same length on purpose: the comparison is constant-time, so the length
      // check must not be the only thing doing the rejecting.
      const wrong = "x".repeat(SECRET.length);
      const res = await POST(post(wrong));
      expect(res.status).toBe(401);
      expect(getTokenMock).not.toHaveBeenCalled();
    });

    it("any request when the secret is unset on the deployment", async () => {
      // Fails closed. An unset secret must not mean "no gate".
      delete process.env.SKILLS_TOKEN_SECRET;
      const res = await POST(post(SECRET));
      expect(res.status).toBe(401);
      expect(getTokenMock).not.toHaveBeenCalled();
    });
  });

  describe("with a valid secret", () => {
    it("returns the token and its expiry in ms", async () => {
      const expSeconds = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
      getTokenMock.mockResolvedValue(jwtWithExp(expSeconds));

      const res = await POST(post(SECRET));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        token: jwtWithExp(expSeconds),
        expiresAt: expSeconds * 1000,
      });
    });

    it("never lets the token be cached by an intermediary", async () => {
      getTokenMock.mockResolvedValue(
        jwtWithExp(Math.floor(Date.now() / 1000) + 3600),
      );
      const res = await POST(post(SECRET));
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("503s when OIDC is unavailable rather than returning a null token", async () => {
      // The realistic cause is OIDC Federation being off for the project.
      getTokenMock.mockRejectedValue(new Error("no OIDC token available"));
      const res = await POST(post(SECRET));
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe("oidc_unavailable");
    });

    it("503s on a token with no readable exp", async () => {
      // Convex caches by expiry. A token whose expiry we can't read would
      // either be used forever or never, so refuse it here instead.
      getTokenMock.mockResolvedValue(jwtWithExp(undefined));
      const res = await POST(post(SECRET));
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe("malformed_token");
    });

    it("503s on a token that isn't a JWT at all", async () => {
      getTokenMock.mockResolvedValue("not-a-jwt");
      const res = await POST(post(SECRET));
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe("malformed_token");
    });
  });
});
