import { describe, it, expect } from "vitest";
import { IpAllowlist } from "./ip-allowlist.js";

describe("IpAllowlist.isAllowed", () => {
  it("empty/undefined allowlist means allow-all", () => {
    expect(IpAllowlist.isAllowed("1.2.3.4")).toBe(true);
    expect(IpAllowlist.isAllowed("1.2.3.4", [])).toBe(true);
  });

  it("matches a plain IPv4 client against an IPv4 CIDR", () => {
    expect(IpAllowlist.isAllowed("10.0.0.5", ["10.0.0.0/8"])).toBe(true);
    expect(IpAllowlist.isAllowed("11.0.0.5", ["10.0.0.0/8"])).toBe(false);
  });

  it("matches an IPv4-mapped IPv6 client against an IPv4 CIDR (dual-stack proxy)", () => {
    // Regression: ::ffff:10.0.0.5 must not be locked out of a 10.0.0.0/8 allowlist.
    expect(IpAllowlist.isAllowed("::ffff:10.0.0.5", ["10.0.0.0/8"])).toBe(true);
    expect(IpAllowlist.isAllowed("::ffff:10.0.0.5", ["192.168.0.0/16"])).toBe(false);
    expect(IpAllowlist.isAllowed("::ffff:192.168.1.5", ["192.168.1.0/24"])).toBe(true);
  });

  it("still matches genuine IPv6 clients against IPv6 CIDRs", () => {
    expect(IpAllowlist.isAllowed("2001:db8::1", ["2001:db8::/32"])).toBe(true);
    expect(IpAllowlist.isAllowed("2001:dead::1", ["2001:db8::/32"])).toBe(false);
  });
});

describe("IpAllowlist.validate", () => {
  it("reports well-formed entries as valid (empty invalid list)", () => {
    expect(IpAllowlist.validate(["10.0.0.0/8", "2001:db8::/32", "192.168.1.5/32"])).toEqual([]);
  });

  it("does not throw on malformed IPv6 with too many groups, reports it invalid", () => {
    // Regression: expandIPv6 previously threw RangeError (Array(-1)) here.
    let result: string[] = [];
    expect(() => {
      result = IpAllowlist.validate(["1:2:3:4:5:6:7:8:9"]);
    }).not.toThrow();
    expect(result).toContain("1:2:3:4:5:6:7:8:9");
  });

  it("flags a non-numeric prefix and garbage addresses", () => {
    expect(IpAllowlist.validate(["10.0.0.0/xx"])).toContain("10.0.0.0/xx");
    expect(IpAllowlist.validate(["not-an-ip"])).toContain("not-an-ip");
  });
});
