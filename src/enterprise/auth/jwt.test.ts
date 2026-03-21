import { describe, it, expect } from "vitest";
import {
  JWTService,
  generateRS256KeyPair,
  generateApiKey,
  hashApiKey,
} from "./jwt.js";
import type { User, AgentIdentity } from "../iam/rbac/model.js";

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
