// @vitest-environment node
//
// Pure unit test over the skills.sh client's auth handling; no Convex VM, so it
// opts out of the suite-wide edge-runtime.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCurated,
  SkillsApiNotFoundError,
  SkillsApiRateLimitError,
} from "../convex/lib/skillsApi";

const OIDC = "header.payload.signature";
const KEY = "sk_live_test";

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown = {}, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

/** The Authorization header sent on the nth fetch call (1-indexed). */
function authOnCall(n: number): string | undefined {
  const init = fetchMock.mock.calls[n - 1][1] as RequestInit;
  return (init.headers as Record<string, string>).Authorization;
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  process.env.SKILLS_SH_API_KEY = KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The migration's core bet: OIDC is the credential we actually run on every
 * day, and the legacy `sk_live_` key is a fallback that only fires when OIDC is
 * rejected. Both halves matter — an OIDC path that silently never runs would
 * leave us on an undocumented key without knowing, and a fallback that fires on
 * the wrong failures would burn the key against rate limits it can't fix.
 */
describe("skills.sh client auth", () => {
  it("sends the OIDC token when one is cached", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }));

    await getCurated({ oidcToken: OIDC });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(authOnCall(1)).toBe(`Bearer ${OIDC}`);
  });

  it("sends the legacy key when no OIDC token is cached", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }));

    await getCurated({ oidcToken: null });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(authOnCall(1)).toBe(`Bearer ${KEY}`);
  });

  it("retries with the legacy key when skills.sh rejects the OIDC token", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: "invalid_token" }))
      .mockResolvedValueOnce(jsonResponse(200, { totalSkills: 3 }));

    const result = await getCurated({ oidcToken: OIDC });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authOnCall(1)).toBe(`Bearer ${OIDC}`);
    expect(authOnCall(2)).toBe(`Bearer ${KEY}`);
    expect(result).toEqual({ totalSkills: 3 });
  });

  it("retries on a 403 as well as a 401", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(403))
      .mockResolvedValueOnce(jsonResponse(200, { totalSkills: 1 }));

    await getCurated({ oidcToken: OIDC });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authOnCall(2)).toBe(`Bearer ${KEY}`);
  });

  it("does not retry a rate limit with the key", async () => {
    // The limit is per (team, project). Spending a second credential on it
    // would not get us a different answer, it would just spend both.
    fetchMock.mockResolvedValue(
      jsonResponse(429, {}, { "Retry-After": "30" }),
    );

    await expect(getCurated({ oidcToken: OIDC })).rejects.toBeInstanceOf(
      SkillsApiRateLimitError,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not retry a 404 with the key", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404));

    await expect(getCurated({ oidcToken: OIDC })).rejects.toBeInstanceOf(
      SkillsApiNotFoundError,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not retry a 5xx with the key", async () => {
    // Transient upstream failures are withTransientRetry's job, and retrying
    // them here would double every attempt.
    fetchMock.mockResolvedValue(jsonResponse(503));

    await expect(getCurated({ oidcToken: OIDC })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("gives up on a 401 when there is no key to fall back to", async () => {
    delete process.env.SKILLS_SH_API_KEY;
    fetchMock.mockResolvedValue(jsonResponse(401, { error: "invalid_token" }));

    await expect(getCurated({ oidcToken: OIDC })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("sends no Authorization header when neither credential exists", async () => {
    // Not a supported configuration, but it must fail as an upstream 401
    // rather than as a TypeError building the headers.
    delete process.env.SKILLS_SH_API_KEY;
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }));

    await getCurated({ oidcToken: null });

    expect(authOnCall(1)).toBeUndefined();
  });
});
