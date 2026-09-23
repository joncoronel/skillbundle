import "server-only";
import { createHmac } from "node:crypto";

/**
 * The key the signed-out repo-match allowance is counted under: an HMAC of the
 * IP, so no address reaches Convex. Pseudonymous rather than anonymous, since
 * Convex also holds the secret.
 */
export function visitorKey(ip: string, secret: string): string {
  return createHmac("sha256", secret).update(normalizeIp(ip)).digest("hex");
}

/**
 * The client IP as Vercel reports it (Vercel overwrites both headers, so they
 * can't be spoofed there). Off Vercel every request shares "unknown".
 */
export function clientIp(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}

/**
 * Collapse an IP to the unit one visitor controls: IPv4 whole, IPv6 to its
 * /64 (one connection gets a whole /64), mapped IPv4 unwrapped. Anything
 * unparseable is returned lowercased as-is.
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
