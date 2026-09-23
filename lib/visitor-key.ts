import "server-only";
import { createHmac } from "node:crypto";

/**
 * The per-visitor key the signed-out repo-match allowance is counted under
 * (convex/rateLimits.ts `repoAnalysisAnonymous`).
 *
 * An HMAC of the visitor's IP, so Convex only ever sees an opaque hex string
 * and the raw address is never sent to it or stored. Keyed with
 * REPO_MATCH_SECRET, which Convex also holds, so this is pseudonymous rather
 * than anonymous: someone with the secret could brute-force the IPv4 space.
 * What it does guarantee is that no IP sits in the database in the clear.
 */
export function visitorKey(ip: string, secret: string): string {
  return createHmac("sha256", secret).update(normalizeIp(ip)).digest("hex");
}

/**
 * The client IP as Vercel reports it: `x-real-ip`, else the first
 * `x-forwarded-for` hop. Vercel's edge sets both and overwrites any value the
 * client sent, so neither can be spoofed from outside on Vercel. Off Vercel
 * (local dev, `next start` for e2e) they are usually absent, and every request
 * shares one "unknown" key.
 */
export function clientIp(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}

/**
 * Collapse an IP to the unit one visitor controls. IPv4 stays whole. IPv6 is
 * cut to its /64: a single home or phone connection is handed a whole /64 and
 * can pick any address in it, so counting full addresses would let one
 * visitor mint 2^64 fresh allowances. IPv4-mapped IPv6 (`::ffff:1.2.3.4`) is
 * treated as the IPv4 it carries. Anything unparseable (including the rare
 * longhand mapped forms) is returned lowercased as-is, which still gives each
 * distinct string its own key.
 */
export function normalizeIp(ip: string): string {
  const raw = ip.trim().toLowerCase();
  if (!raw.includes(":")) return raw;

  // Drop a zone id (`fe80::1%eth0`).
  const addr = raw.split("%")[0];
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return mapped[1];

  const groups = expandIpv6(addr);
  if (!groups) return raw;
  return `${groups.slice(0, 4).join(":")}::/64`;
}

/** The eight 16-bit groups of an IPv6 address, zero-padded, or null. */
function expandIpv6(addr: string): string[] | null {
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(missing).fill("0"), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.padStart(4, "0"));
}
