/**
 * IP allowlist — CIDR-based per-user and per-tenant access control.
 *
 * Supports IPv4 and IPv6 CIDR notation.
 * An empty allowlist means "allow all" (opt-in restriction, not deny-by-default).
 *
 * No external dependencies — pure Node.js.
 */

import { isIPv4 } from "node:net";

// ── IPv4 CIDR matching ────────────────────────────────────────────────────────

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    throw new Error(`Invalid IPv4 address: ${ip}`);
  }
  return (parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!;
}

function matchIPv4Cidr(ip: string, cidr: string): boolean {
  const [range, prefix] = cidr.split("/");
  if (!range || prefix === undefined) return ip === cidr;
  const prefixLen = parseInt(prefix, 10);
  if (isNaN(prefixLen) || prefixLen < 0 || prefixLen > 32) return false;
  const mask = prefixLen === 0 ? 0 : ~((1 << (32 - prefixLen)) - 1);
  try {
    return (ipv4ToInt(ip) & mask) === (ipv4ToInt(range) & mask);
  } catch {
    return false;
  }
}

// ── IPv6 expansion ────────────────────────────────────────────────────────────

function expandIPv6(ip: string): bigint {
  // Handle ::1, ::ffff:x.x.x.x etc.
  let addr = ip;

  // IPv4-mapped IPv6: ::ffff:a.b.c.d
  const ipv4Mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (ipv4Mapped) {
    addr = `::ffff:${ipv4Mapped[1]!
      .split(".")
      .map((n) => parseInt(n, 10).toString(16).padStart(2, "0"))
      .join("")
      .replace(/(.{4})(.{4})/, "$1:$2")}`;
  }

  const parts = addr.split("::");
  if (parts.length > 2) return -1n; // invalid
  const left = parts[0] ? parts[0].split(":") : [];
  const right = parts[1] ? parts[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  // Guard against malformed addresses with too many groups (e.g. 9 groups and
  // no "::"): Array(negative).fill(...) throws RangeError. Report invalid via
  // the -1n sentinel instead of crashing callers such as validate().
  if (missing < 0) return -1n;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8) return -1n;

  let result = 0n;
  for (const g of groups) {
    const v = parseInt(g, 16);
    if (isNaN(v)) return -1n;
    result = (result << 16n) | BigInt(v);
  }
  return result;
}

function matchIPv6Cidr(ip: string, cidr: string): boolean {
  const [range, prefix] = cidr.split("/");
  if (!range) return false;
  const prefixLen = prefix ? parseInt(prefix, 10) : 128;
  if (isNaN(prefixLen) || prefixLen < 0 || prefixLen > 128) return false;

  const ipInt = expandIPv6(ip);
  const rangeInt = expandIPv6(range);
  if (ipInt < 0n || rangeInt < 0n) return false;

  if (prefixLen === 0) return true;
  const shift = 128n - BigInt(prefixLen);
  return ipInt >> shift === rangeInt >> shift;
}

// ── Unified matcher ───────────────────────────────────────────────────────────

/**
 * Collapse an IPv4-mapped IPv6 address (::ffff:a.b.c.d) to its embedded dotted
 * IPv4 so it can match IPv4 CIDR allowlist entries. Non-mapped addresses are
 * returned unchanged.
 */
function normalizeMappedIpv4(ip: string): string {
  const mapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  return mapped ? mapped[1]! : ip;
}

function matchesCidr(ip: string, cidr: string): boolean {
  // Normalize IPv4-mapped IPv6 clients (::ffff:10.0.0.5) to plain IPv4 so a
  // dual-stack proxy client can still match an IPv4 CIDR such as 10.0.0.0/8.
  ip = normalizeMappedIpv4(ip);
  // Handle CIDR notation
  if (isIPv4(ip)) {
    // May be an IPv4-mapped IPv6 CIDR
    if (cidr.includes(":") || cidr.includes("::")) return false;
    return matchIPv4Cidr(ip, cidr);
  }
  // IPv6
  if (!cidr.includes(":")) return false; // IPv4 CIDR can't match IPv6
  return matchIPv6Cidr(ip, cidr);
}

// ── Public API ─────────────────────────────────────────────────────────────────

export class IpAllowlist {
  /**
   * Check if an IP is allowed given a list of CIDR ranges.
   *
   * An empty or undefined allowlist means "allow all".
   * A non-empty allowlist means "allow only if the IP matches at least one range".
   *
   * @param ip       - The client IP address (IPv4 or IPv6)
   * @param cidrs    - Array of CIDR strings, e.g. ["10.0.0.0/8", "192.168.1.5/32"]
   */
  static isAllowed(ip: string, cidrs?: string[]): boolean {
    if (!cidrs || cidrs.length === 0) return true;
    for (const cidr of cidrs) {
      try {
        if (matchesCidr(ip, cidr)) return true;
      } catch {
        // Skip malformed CIDRs
      }
    }
    return false;
  }

  /**
   * Validate that all entries in a CIDR list are well-formed.
   * Returns an array of invalid entries.
   */
  static validate(cidrs: string[]): string[] {
    const invalid: string[] = [];
    for (const cidr of cidrs) {
      const [addr, prefix] = cidr.split("/");
      if (!addr) {
        invalid.push(cidr);
        continue;
      }
      if (prefix !== undefined) {
        const n = parseInt(prefix, 10);
        if (isNaN(n)) {
          invalid.push(cidr);
          continue;
        }
      }
      // Quick format check
      if (!isIPv4(addr) && expandIPv6(addr) < 0n) {
        invalid.push(cidr);
      }
    }
    return invalid;
  }
}
