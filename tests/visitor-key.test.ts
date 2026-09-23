// @vitest-environment node
//
// lib/visitor-key.ts uses `node:crypto`'s createHmac, which edge-runtime (the
// suite's default, for convex-test) does not provide.

import { describe, expect, test } from "vitest";
import { clientIp, normalizeIp, visitorKey } from "../lib/visitor-key";

describe("normalizeIp", () => {
  test("IPv4 stays whole", () => {
    expect(normalizeIp(" 203.0.113.7 ")).toBe("203.0.113.7");
  });

  test("IPv6 collapses to its /64", () => {
    expect(normalizeIp("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe(
      "2001:0db8:85a3:08d3::/64",
    );
  });

  test("two addresses in one /64 are one visitor", () => {
    expect(normalizeIp("2001:db8::1")).toBe(
      normalizeIp("2001:DB8:0:0:ffff::2"),
    );
  });

  test("compressed forms expand before cutting", () => {
    expect(normalizeIp("::1")).toBe("0000:0000:0000:0000::/64");
    expect(normalizeIp("fe80::1%eth0")).toBe("fe80:0000:0000:0000::/64");
  });

  test("IPv4-mapped IPv6 is the IPv4 it carries", () => {
    expect(normalizeIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  test("unparseable input passes through lowercased", () => {
    expect(normalizeIp("NOT:AN:IP")).toBe("not:an:ip");
  });
});

describe("clientIp", () => {
  test("prefers x-real-ip, then the first x-forwarded-for hop", () => {
    expect(
      clientIp(
        new Headers({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }),
      ),
    ).toBe("1.1.1.1");
    expect(
      clientIp(new Headers({ "x-forwarded-for": "2.2.2.2, 10.0.0.1" })),
    ).toBe("2.2.2.2");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("visitorKey", () => {
  test("is a hex HMAC that never contains the IP", () => {
    const key = visitorKey("203.0.113.7", "secret");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("203.0.113.7");
  });

  test("depends on the secret and on the /64, not the full address", () => {
    expect(visitorKey("2001:db8::1", "s")).toBe(visitorKey("2001:db8::2", "s"));
    expect(visitorKey("2001:db8::1", "s")).not.toBe(
      visitorKey("2001:db8::1", "t"),
    );
  });
});
