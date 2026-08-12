// @vitest-environment node
//
// The rest of the suite runs in edge-runtime (see vitest.config.ts) because
// convex-test needs it. This route uses `node:crypto`'s timingSafeEqual, which
// edge-runtime does not provide, so this file opts into node.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { revalidateTagMock } = vi.hoisted(() => ({
  revalidateTagMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidateTag: revalidateTagMock }));

import { POST } from "../app/api/revalidate/route";
import { SITE_TAGS } from "../lib/cache-tags";

const SECRET = "test-secret-value";

function post(body: unknown, secret?: string, rawBody?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== undefined) headers["x-revalidate-secret"] = secret;
  return new Request("http://localhost/api/revalidate", {
    method: "POST",
    headers,
    body: rawBody ?? JSON.stringify(body),
  });
}

beforeEach(() => {
  revalidateTagMock.mockClear();
  process.env.REVALIDATE_SECRET = SECRET;
});

/**
 * Covers the parts of the route that are decidable without a deployment: the
 * shared-secret gate and the tag allowlist. Whether `revalidateTag` actually
 * evicts anything is Next/Vercel behaviour and is asserted at the call, not the
 * effect — see docs/architecture.md §1 for the measurement that showed the
 * shared cache is real.
 *
 * This route is the only unauthenticated write surface in the app (it is
 * deliberately outside Clerk's private-route list — see proxy.ts), so the gate
 * is the whole security story.
 */
describe("POST /api/revalidate", () => {
  describe("rejects", () => {
    it("a request with no secret header", async () => {
      const res = await POST(post({ tag: "skill-sync" }));
      expect(res.status).toBe(401);
      expect(revalidateTagMock).not.toHaveBeenCalled();
    });

    it("a wrong secret of the same length", async () => {
      // Same length on purpose: the comparison is constant-time and the
      // length check must not be the only thing rejecting it.
      const wrong = "x".repeat(SECRET.length);
      expect(wrong).toHaveLength(SECRET.length);
      const res = await POST(post({ tag: "skill-sync" }, wrong));
      expect(res.status).toBe(401);
      expect(revalidateTagMock).not.toHaveBeenCalled();
    });

    it("a secret that is a prefix of the real one", async () => {
      // timingSafeEqual throws on unequal lengths; the route must fail closed
      // rather than surface a 500.
      const res = await POST(post({ tag: "skill-sync" }, SECRET.slice(0, 4)));
      expect(res.status).toBe(401);
      expect(revalidateTagMock).not.toHaveBeenCalled();
    });

    it("every request when the server has no secret configured", async () => {
      delete process.env.REVALIDATE_SECRET;
      const res = await POST(post({ tag: "skill-sync" }, SECRET));
      expect(res.status).toBe(401);
      expect(revalidateTagMock).not.toHaveBeenCalled();
    });

    it("a body that is not JSON", async () => {
      const res = await POST(post(null, SECRET, "not json"));
      expect(res.status).toBe(400);
      expect(revalidateTagMock).not.toHaveBeenCalled();
    });

    it("a tag outside the allowlist", async () => {
      const res = await POST(post({ tag: "arbitrary-tag" }, SECRET));
      expect(res.status).toBe(400);
      expect(revalidateTagMock).not.toHaveBeenCalled();
    });

    it("a non-string tag", async () => {
      const res = await POST(post({ tag: 42 }, SECRET));
      expect(res.status).toBe(400);
      expect(revalidateTagMock).not.toHaveBeenCalled();
    });
  });

  describe("accepts", () => {
    // Spelled out rather than imported from lib/cache-tags.ts on purpose: the
    // route derives its allowlist from that module, so importing it here would
    // make this test tautological. This literal is the independent statement of
    // what the route must accept. `convex/lib/revalidate.ts` takes its `SiteTag`
    // union from the same module, so the Convex side is checked by the compiler
    // — this covers the runtime half.
    //
    // Worth keeping honest because the failure is silent: a tag Convex pings
    // that the route rejects returns 400, which revalidateSiteTag logs and
    // swallows, and the publish quietly degrades to the time-based fallback.
    const ALLOWED = [
      "home-hot",
      "home-trending",
      "home-popular",
      "skill-sync",
      "skill-content",
    ];

    it("accepts exactly these tags and no others", () => {
      expect([...SITE_TAGS].sort()).toEqual([...ALLOWED].sort());
    });

    for (const tag of ALLOWED) {
      it(`revalidates "${tag}" with immediate expiry`, async () => {
        const res = await POST(post({ tag }, SECRET));
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({ revalidated: true, tag });

        // The two-argument form is deliberate and load-bearing: the
        // single-argument call is deprecated, and `{ expire: 0 }` is how a
        // Route Handler gets immediate expiry (updateTag is Server-Actions
        // only). See the comment in the route.
        expect(revalidateTagMock).toHaveBeenCalledExactlyOnceWith(tag, {
          expire: 0,
        });
      });
    }
  });
});
