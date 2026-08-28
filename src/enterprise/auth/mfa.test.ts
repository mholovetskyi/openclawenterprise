import { describe, it, expect } from "vitest";
import { MfaService } from "./mfa.js";

describe("MfaService — enrollment", () => {
  it("generates a base32 secret and otpauth URI", () => {
    const { secret, otpauthUri } = MfaService.generateEnrollment("user-1", "u@example.com");
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(otpauthUri).toContain("otpauth://totp/");
    expect(otpauthUri).toContain(`secret=${secret}`);
  });

  it("produces a unique secret each time", () => {
    const a = MfaService.generateEnrollment("user-1");
    const b = MfaService.generateEnrollment("user-1");
    expect(a.secret).not.toBe(b.secret);
  });
});

describe("MfaService — verify", () => {
  it("round-trips generate() -> verify()", () => {
    const { secret } = MfaService.generateEnrollment("ok-user");
    const code = MfaService.generate(secret);
    expect(MfaService.verify(secret, code)).toBe(true);
  });

  it("enforces one-time use: a consumed code cannot be replayed", () => {
    const { secret } = MfaService.generateEnrollment("replay-user");
    const code = MfaService.generate(secret);
    expect(MfaService.verify(secret, code)).toBe(true);
    // Replay of the same code within its validity window is rejected.
    expect(MfaService.verify(secret, code)).toBe(false);
    expect(MfaService.verify(secret, code)).toBe(false);
  });

  it("rejects an incorrect code", () => {
    const { secret } = MfaService.generateEnrollment("wrong-user");
    expect(MfaService.verify(secret, "000000")).toBe(false);
  });

  it("rejects codes of the wrong length without throwing (constant-time compare)", () => {
    const { secret } = MfaService.generateEnrollment("len-user");
    expect(MfaService.verify(secret, "1")).toBe(false);
    expect(MfaService.verify(secret, "1234567")).toBe(false);
    expect(MfaService.verify(secret, "")).toBe(false);
  });

  it("replay protection is scoped per secret (one user cannot block another)", () => {
    const a = MfaService.generateEnrollment("user-a").secret;
    const b = MfaService.generateEnrollment("user-b").secret;
    const codeA = MfaService.generate(a);
    const codeB = MfaService.generate(b);
    expect(MfaService.verify(a, codeA)).toBe(true);
    expect(MfaService.verify(b, codeB)).toBe(true);
    // Each is independently replay-protected.
    expect(MfaService.verify(a, codeA)).toBe(false);
    expect(MfaService.verify(b, codeB)).toBe(false);
  });

  it("accepts a code from an adjacent step within the ±1 skew window", () => {
    const { secret } = MfaService.generateEnrollment("skew-user");
    const now = Math.floor(Date.now() / 1000);
    // Code minted for the current step S.
    const code = MfaService.generate(secret);
    // Verifying 30s later (nowSec = now+30) places step S at the window's -1
    // edge, so a well-behaved verifier still accepts it — first use, no replay.
    expect(MfaService.verify(secret, code, now + 30)).toBe(true);
  });
});
