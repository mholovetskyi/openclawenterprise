import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import type { User, AgentIdentity } from "../iam/rbac/model.js";
import {
  JWTService,
  generateRS256KeyPair,
  generateApiKey,
  hashApiKey,
  type JWTConfig,
  type TokenStoreSink,
} from "./jwt.js";

const testUser: User = {
  id: "user-123",
  email: "test@example.com",
  name: "Test User",
  roles: ["viewer"],
  groups: [],
  enabled: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const testAgent: AgentIdentity = {
  id: "agent-456",
  name: "My Agent",
  roles: ["agent-service"],
  enabled: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("JWTService — HS256", () => {
  const svc = new JWTService({ algorithm: "HS256", secret: "test-secret-1234567890abcdef" });

  it("issues tokens with all required fields", () => {
    const result = svc.issueForUser(testUser);
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.tokenType).toBe("Bearer");
    expect(result.expiresIn).toBe(900); // 15 min default
  });

  it("decodes a valid access token", () => {
    const { accessToken } = svc.issueForUser(testUser);
    const payload = svc.decode(accessToken);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe("user-123");
    expect(payload!.type).toBe("access");
    expect(payload!.identityType).toBe("user");
    expect(payload!.email).toBe("test@example.com");
    expect(payload!.roles).toContain("viewer");
  });

  it("decodes a valid refresh token", () => {
    const { refreshToken } = svc.issueForUser(testUser);
    const payload = svc.decode(refreshToken);
    expect(payload).not.toBeNull();
    expect(payload!.type).toBe("refresh");
    expect(payload!.roles).toEqual([]); // refresh tokens carry no roles
  });

  it("issues for agent with correct identityType", () => {
    const { accessToken } = svc.issueForAgent(testAgent);
    const payload = svc.decode(accessToken);
    expect(payload!.identityType).toBe("agent");
    expect(payload!.sub).toBe("agent-456");
  });

  it("returns null for tokens signed with a different secret", () => {
    const other = new JWTService({ algorithm: "HS256", secret: "different-secret" });
    const { accessToken } = other.issueForUser(testUser);
    expect(svc.decode(accessToken)).toBeNull();
  });

  it("returns null for a truncated token", () => {
    const { accessToken } = svc.issueForUser(testUser);
    expect(svc.decode(accessToken.slice(0, 20))).toBeNull();
  });

  it("returns null for a token with only 2 parts", () => {
    expect(svc.decode("header.payload")).toBeNull();
  });

  it("returns null for a token with tampered payload", () => {
    const { accessToken } = svc.issueForUser(testUser);
    const parts = accessToken.split(".");
    // Replace payload with different base64url content
    parts[1] = Buffer.from(JSON.stringify({ sub: "hacker", exp: 9999999999 })).toString(
      "base64url",
    );
    expect(svc.decode(parts.join("."))).toBeNull();
  });

  it("returns null for an expired token", () => {
    // Use -1100ms so Math.floor(-1100/1000) = -1, giving exp = now - 1 (past)
    const expiredSvc = new JWTService({
      algorithm: "HS256",
      secret: "test-secret",
      accessTokenTtlMs: -1100,
    });
    const { accessToken } = expiredSvc.issueForUser(testUser);
    expect(expiredSvc.decode(accessToken)).toBeNull();
  });

  it("uses custom issuer and audience", () => {
    const custom = new JWTService({
      algorithm: "HS256",
      secret: "s3cret",
      issuer: "my-service",
      audience: "my-app",
    });
    const { accessToken } = custom.issueForUser(testUser);
    const payload = custom.decode(accessToken);
    expect(payload!.iss).toBe("my-service");
    expect(payload!.aud).toBe("my-app");
  });

  it("each token has a unique jti", () => {
    const a = svc.issueForUser(testUser);
    const b = svc.issueForUser(testUser);
    const payloadA = svc.decode(a.accessToken);
    const payloadB = svc.decode(b.accessToken);
    expect(payloadA!.jti).not.toBe(payloadB!.jti);
  });
});

describe("JWTService — HS256 empty secret (fail closed)", () => {
  it("throws at construction when HS256 secret is missing", () => {
    expect(() => new JWTService({ algorithm: "HS256" })).toThrow(/non-empty secret/);
  });

  it("throws at construction when HS256 secret is empty string", () => {
    expect(() => new JWTService({ algorithm: "HS256", secret: "" })).toThrow(/non-empty secret/);
  });

  it("does not throw for RS256 with no secret", () => {
    const { privateKey, publicKey } = generateRS256KeyPair();
    expect(() => new JWTService({ algorithm: "RS256", privateKey, publicKey })).not.toThrow();
  });
});

describe("JWTService — decode claim enforcement", () => {
  const svc = new JWTService({ algorithm: "HS256", secret: "test-secret-1234567890abcdef" });

  it("rejects a refresh token when an access token is required", () => {
    const { refreshToken } = svc.issueForUser(testUser);
    expect(svc.decode(refreshToken, { expectedType: "access" })).toBeNull();
    expect(svc.verifyAccessToken(refreshToken)).toBeNull();
  });

  it("accepts an access token via verifyAccessToken", () => {
    const { accessToken } = svc.issueForUser(testUser);
    expect(svc.verifyAccessToken(accessToken)).not.toBeNull();
  });

  it("rejects a token whose issuer does not match (same secret, different iss)", () => {
    const issuerA = new JWTService({
      algorithm: "HS256",
      secret: "test-secret-1234567890abcdef",
      issuer: "idp-a",
    });
    const verifierB = new JWTService({
      algorithm: "HS256",
      secret: "test-secret-1234567890abcdef",
      issuer: "idp-b",
    });
    const { accessToken } = issuerA.issueForUser(testUser);
    // Signature is valid (shared secret) but issuer mismatches.
    expect(verifierB.decode(accessToken)).toBeNull();
  });

  it("rejects a token whose audience does not match", () => {
    const audA = new JWTService({
      algorithm: "HS256",
      secret: "test-secret-1234567890abcdef",
      audience: "app-a",
    });
    const verifierB = new JWTService({
      algorithm: "HS256",
      secret: "test-secret-1234567890abcdef",
      audience: "app-b",
    });
    const { accessToken } = audA.issueForUser(testUser);
    expect(verifierB.decode(accessToken)).toBeNull();
  });

  it("rejects a validly-signed token whose nbf is in the future beyond skew", () => {
    const secret = "test-secret-1234567890abcdef";
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sub: "user-123",
        iss: "openclaw",
        aud: "openclaw",
        iat: now,
        nbf: now + 3600, // an hour in the future
        exp: now + 7200,
        jti: "abc",
        type: "access",
        identityType: "user",
      }),
    ).toString("base64url");
    const sig = createHmac("sha256", secret)
      .update(`${header}.${payload}`)
      .digest()
      .toString("base64url");
    const token = `${header}.${payload}.${sig}`;
    // Signature is valid; decode must still reject on nbf.
    expect(svc.decode(token)).toBeNull();
  });
});

describe("JWTService — token store wiring", () => {
  class FakeTokenStore implements TokenStoreSink {
    stored: Array<{ jti: string; subjectId: string; rawToken: string }> = [];
    revoked = new Set<string>();
    storeRefreshToken(jti: string, subjectId: string, rawToken: string): void {
      this.stored.push({ jti, subjectId, rawToken });
    }
    isAccessTokenRevoked(jti: string): boolean {
      return this.revoked.has(jti);
    }
  }

  it("persists the refresh token on issue()", () => {
    const store = new FakeTokenStore();
    const svc = new JWTService(
      { algorithm: "HS256", secret: "test-secret-1234567890abcdef" },
      store,
    );
    const { refreshToken } = svc.issueForUser(testUser);
    expect(store.stored).toHaveLength(1);
    expect(store.stored[0]!.subjectId).toBe("user-123");
    expect(store.stored[0]!.rawToken).toBe(refreshToken);
  });

  it("rejects a revoked access token on decode()", () => {
    const store = new FakeTokenStore();
    const svc = new JWTService(
      { algorithm: "HS256", secret: "test-secret-1234567890abcdef" },
      store,
    );
    const { accessToken } = svc.issueForUser(testUser);
    const decoded = svc.decode(accessToken);
    expect(decoded).not.toBeNull();
    store.revoked.add(decoded!.jti);
    expect(svc.decode(accessToken)).toBeNull();
    expect(svc.verifyAccessToken(accessToken)).toBeNull();
  });

  it("still works with no token store wired", () => {
    const svc = new JWTService({ algorithm: "HS256", secret: "test-secret-1234567890abcdef" });
    const { accessToken } = svc.issueForUser(testUser);
    expect(svc.decode(accessToken)).not.toBeNull();
  });
});

describe("JWTService — RS256", () => {
  it("issues and decodes with generated key pair", () => {
    const { privateKey, publicKey } = generateRS256KeyPair();
    const svc = new JWTService({ algorithm: "RS256", privateKey, publicKey });
    const { accessToken } = svc.issueForUser(testUser);
    const payload = svc.decode(accessToken);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe("user-123");
  });

  it("rejects token signed with a different private key", () => {
    const pair1 = generateRS256KeyPair();
    const pair2 = generateRS256KeyPair();
    const svc1 = new JWTService({ algorithm: "RS256", ...pair1 });
    const svc2 = new JWTService({ algorithm: "RS256", ...pair2 });
    const { accessToken } = svc1.issueForUser(testUser);
    expect(svc2.decode(accessToken)).toBeNull();
  });
});

describe("generateRS256KeyPair", () => {
  it("returns PEM-encoded keys", () => {
    const { privateKey, publicKey } = generateRS256KeyPair();
    expect(privateKey).toContain("-----BEGIN PRIVATE KEY-----");
    expect(publicKey).toContain("-----BEGIN PUBLIC KEY-----");
  });
});

describe("generateApiKey", () => {
  it("returns key and hash strings", () => {
    const { key, hash } = generateApiKey();
    expect(typeof key).toBe("string");
    expect(typeof hash).toBe("string");
  });

  it("key starts with default prefix 'oc_'", () => {
    const { key } = generateApiKey();
    expect(key.startsWith("oc_")).toBe(true);
  });

  it("key starts with custom prefix", () => {
    const { key } = generateApiKey("sk");
    expect(key.startsWith("sk_")).toBe(true);
  });

  it("hash is a 64-char hex string (SHA-256)", () => {
    const { hash } = generateApiKey();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hash matches hashApiKey(key)", () => {
    const { key, hash } = generateApiKey();
    expect(hashApiKey(key)).toBe(hash);
  });

  it("generates unique keys", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key).not.toBe(b.key);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("hashApiKey", () => {
  it("is deterministic", () => {
    const key = "oc_testkey";
    expect(hashApiKey(key)).toBe(hashApiKey(key));
  });

  it("produces 64-char hex output", () => {
    expect(hashApiKey("anything")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different keys produce different hashes", () => {
    expect(hashApiKey("key-a")).not.toBe(hashApiKey("key-b"));
  });
});
