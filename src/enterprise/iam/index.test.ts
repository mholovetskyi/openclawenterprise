/**
 * Tests for initIAM wiring:
 *  - the persistent TokenStore is wired into JWTService (session persistence /
 *    revocation is no longer inert), and
 *  - HS256 misconfiguration (empty / short secret) fails closed at startup.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import { JWTService } from "../auth/jwt.js";
import type { TokenStoreSink } from "../auth/jwt.js";
import { initIAM } from "./index.js";

// ── detect optional native dep ──────────────────────────────────────────────
// The real persistent TokenStore requires better-sqlite3. When it is absent,
// initIAM falls back to an in-memory RBAC store with tokens=null, so the
// end-to-end persistence assertions are skipped — but the wiring *contract*
// (below) is always exercised against a fake sink.
let sqliteAvailable = false;
try {
  const { createRequire } = await import("node:module");
  createRequire(import.meta.url)("better-sqlite3");
  sqliteAvailable = true;
} catch {
  sqliteAvailable = false;
}

function baseCfg(jwt: Record<string, unknown>): OpenClawConfig {
  return {
    enterprise: { iam: { jwt } },
  } as unknown as OpenClawConfig;
}

describe("initIAM — HS256 secret fail-closed guard", () => {
  const savedStateDir = process.env.OPENCLAW_STATE_DIR;
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iam-hs256-"));
    process.env.OPENCLAW_STATE_DIR = tmp;
  });

  afterEach(async () => {
    if (savedStateDir === undefined) delete process.env.OPENCLAW_STATE_DIR;
    else process.env.OPENCLAW_STATE_DIR = savedStateDir;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("throws when HS256 is configured with no secret", async () => {
    await expect(initIAM(baseCfg({ algorithm: "HS256" }))).rejects.toThrow(/HS256/);
  });

  it("throws when HS256 is configured with an empty secret", async () => {
    await expect(initIAM(baseCfg({ algorithm: "HS256", secret: "" }))).rejects.toThrow(/HS256/);
  });

  it("throws when the HS256 secret is shorter than 32 bytes", async () => {
    await expect(initIAM(baseCfg({ algorithm: "HS256", secret: "short-secret" }))).rejects.toThrow(
      /at least 32 bytes/,
    );
  });

  it("rejects a 31-char secret that is exactly one byte short", async () => {
    const secret = "a".repeat(31);
    await expect(initIAM(baseCfg({ algorithm: "HS256", secret }))).rejects.toThrow(
      /at least 32 bytes/,
    );
  });

  it("accepts a secret that is exactly 32 bytes (boundary)", async () => {
    const handle = await initIAM(baseCfg({ algorithm: "HS256", secret: "a".repeat(32) }));
    expect(handle.jwt).toBeInstanceOf(JWTService);
    await handle.shutdown();
  });

  it("boots with a >=32-byte HS256 secret", async () => {
    const handle = await initIAM(baseCfg({ algorithm: "HS256", secret: "x".repeat(48) }));
    expect(handle.jwt).toBeInstanceOf(JWTService);
    await handle.shutdown();
  });
});

describe("JWTService token-store wiring contract (what initIAM activates)", () => {
  // A minimal in-memory stand-in for TokenStore that satisfies TokenStoreSink.
  // This exercises the exact contract initIAM now wires: refresh tokens are
  // persisted on issue, and revoked access JTIs are rejected at verify time.
  class FakeSink implements TokenStoreSink {
    stored: string[] = [];
    private revoked = new Set<string>();
    storeRefreshToken(jti: string): void {
      this.stored.push(jti);
    }
    isAccessTokenRevoked(jti: string): boolean {
      return this.revoked.has(jti);
    }
    revoke(jti: string): void {
      this.revoked.add(jti);
    }
  }

  it("persists the refresh token on issue", () => {
    const sink = new FakeSink();
    const jwt = new JWTService({ algorithm: "HS256", secret: "x".repeat(48) }, sink);
    jwt.issue({ sub: "alice", identityType: "user", roles: ["viewer"] });
    expect(sink.stored).toHaveLength(1);
  });

  it("rejects an access token once its JTI is revoked", () => {
    const sink = new FakeSink();
    const jwt = new JWTService({ algorithm: "HS256", secret: "x".repeat(48) }, sink);
    const { accessToken } = jwt.issue({ sub: "alice", identityType: "user", roles: [] });

    const before = jwt.verifyAccessToken(accessToken);
    expect(before).not.toBeNull();

    sink.revoke(before!.jti);
    expect(jwt.verifyAccessToken(accessToken)).toBeNull();
  });

  it("without a sink, issue/verify still work (community/basic backward compat)", () => {
    const jwt = new JWTService({ algorithm: "HS256", secret: "x".repeat(48) });
    const { accessToken } = jwt.issue({ sub: "bob", identityType: "user", roles: [] });
    expect(jwt.verifyAccessToken(accessToken)).not.toBeNull();
  });
});

describe.skipIf(!sqliteAvailable)(
  "initIAM — end-to-end token persistence (requires better-sqlite3)",
  () => {
    const savedStateDir = process.env.OPENCLAW_STATE_DIR;
    let tmp: string;

    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iam-e2e-"));
      process.env.OPENCLAW_STATE_DIR = tmp;
    });

    afterEach(() => {
      if (savedStateDir === undefined) delete process.env.OPENCLAW_STATE_DIR;
      else process.env.OPENCLAW_STATE_DIR = savedStateDir;
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it("records the issued refresh token as an active session and rejects a revoked access token", async () => {
      const handle = await initIAM(baseCfg({ algorithm: "HS256", secret: "x".repeat(48) }));
      expect(handle.tokens).not.toBeNull();

      const { accessToken } = handle.jwt.issue({
        sub: "carol",
        identityType: "user",
        roles: ["viewer"],
      });

      // Refresh token persisted → session is listable (proves jwt got the store).
      const sessions = handle.tokens!.listActiveSessions("carol");
      expect(sessions).toHaveLength(1);

      // Revoke the access token → jwt.decode consults the same store and rejects it.
      const payload = handle.jwt.verifyAccessToken(accessToken)!;
      handle.tokens!.revokeAccessToken(payload.jti, payload.exp);
      expect(handle.jwt.verifyAccessToken(accessToken)).toBeNull();

      await handle.shutdown();
    });
  },
);
