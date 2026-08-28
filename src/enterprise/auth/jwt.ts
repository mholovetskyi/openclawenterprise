/**
 * JWT authentication — RS256 (asymmetric) or HS256 (symmetric).
 *
 * Access tokens: 15 minutes (configurable)
 * Refresh tokens: 7 days (configurable)
 * Revocation via SQLite token blacklist.
 */

import {
  createHmac,
  createSign,
  createVerify,
  generateKeyPairSync,
  randomBytes,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import type { User, AgentIdentity } from "../iam/rbac/model.js";

/**
 * Minimal surface of the refresh-token / access-token store that JWTService
 * consults so that issued refresh tokens are persisted and revoked access
 * tokens are rejected. Kept as an interface so jwt.ts does not depend on the
 * concrete TokenStore (SQLite) implementation.
 */
export interface TokenStoreSink {
  storeRefreshToken(
    jti: string,
    subjectId: string,
    rawToken: string,
    issuedAt: number,
    expiresAt: number,
    meta?: { userAgent?: string; ipAddress?: string },
  ): void;
  isAccessTokenRevoked(jti: string): boolean;
}

export type JWTAlgorithm = "RS256" | "HS256";

export type JWTConfig = {
  algorithm: JWTAlgorithm;
  secret?: string; // HS256: shared secret
  privateKey?: string; // RS256: PEM private key
  publicKey?: string; // RS256: PEM public key
  accessTokenTtlMs?: number; // default 900_000 (15 min)
  refreshTokenTtlMs?: number; // default 604_800_000 (7 days)
  issuer?: string;
  audience?: string;
};

export type JWTPayload = {
  sub: string; // subject: user or agent ID
  iss?: string; // issuer
  aud?: string; // audience
  iat: number; // issued at (seconds)
  nbf?: number; // not-before (seconds)
  exp: number; // expiry (seconds)
  jti: string; // JWT ID (unique per token)
  type: "access" | "refresh";
  identityType: "user" | "agent";
  roles?: string[];
  tenantId?: string;
  email?: string;
  name?: string;
};

export type JWTKeyPair = {
  privateKey: string;
  publicKey: string;
};

export type IssueTokenResult = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds until access token expires
  tokenType: "Bearer";
};

// ── Key generation ─────────────────────────────────────────────────────────────

export function generateRS256KeyPair(): JWTKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { privateKey, publicKey };
}

// ── JWT encoding/decoding ─────────────────────────────────────────────────────

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64url");
}

function encodeHeader(algorithm: JWTAlgorithm): string {
  return b64url(JSON.stringify({ alg: algorithm, typ: "JWT" }));
}

function encodePayload(payload: JWTPayload): string {
  return b64url(JSON.stringify(payload));
}

function sign(data: string, config: JWTConfig): string {
  if (config.algorithm === "HS256") {
    // Fail closed: an empty HS256 secret means anyone can forge tokens by
    // HMAC-ing under the empty key. Never sign under "".
    if (!config.secret) throw new Error("HS256 requires a non-empty secret");
    return b64url(createHmac("sha256", config.secret).update(data).digest());
  }
  // RS256
  if (!config.privateKey) throw new Error("RS256 requires privateKey in JWTConfig");
  const signer = createSign("RSA-SHA256");
  signer.update(data);
  return b64url(signer.sign(config.privateKey));
}

function verify(header: string, payload: string, signature: string, config: JWTConfig): boolean {
  const data = `${header}.${payload}`;
  if (config.algorithm === "HS256") {
    // Fail closed: refuse to verify under an empty secret (would accept
    // attacker-minted tokens HMAC-signed with "").
    if (!config.secret) throw new Error("HS256 requires a non-empty secret");
    const expected = b64url(createHmac("sha256", config.secret).update(data).digest());
    // Constant-time comparison over equal-length buffers.
    const sigBuf = Buffer.from(signature, "utf8");
    const expBuf = Buffer.from(expected, "utf8");
    if (sigBuf.length !== expBuf.length) return false;
    return timingSafeEqual(sigBuf, expBuf);
  }
  // RS256
  if (!config.publicKey) throw new Error("RS256 requires publicKey in JWTConfig");
  const verifier = createVerify("RSA-SHA256");
  verifier.update(data);
  try {
    return verifier.verify(config.publicKey, Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export class JWTService {
  private config: Required<JWTConfig> & JWTConfig;
  private readonly tokenStore: TokenStoreSink | null;

  constructor(config: JWTConfig, tokenStore?: TokenStoreSink | null) {
    this.config = {
      accessTokenTtlMs: 900_000,
      refreshTokenTtlMs: 604_800_000,
      issuer: "openclaw",
      audience: "openclaw",
      secret: "",
      privateKey: "",
      publicKey: "",
      ...config,
    };
    // Fail closed at construction: HS256 with an empty secret would mint and
    // accept forgeable tokens. Surface the misconfiguration immediately rather
    // than silently HMAC-ing under "".
    if (this.config.algorithm === "HS256" && !this.config.secret) {
      throw new Error("HS256 requires a non-empty secret");
    }
    this.tokenStore = tokenStore ?? null;
  }

  issueForUser(user: User): IssueTokenResult {
    return this.issue({
      sub: user.id,
      identityType: "user",
      roles: user.roles,
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
    });
  }

  issueForAgent(agent: AgentIdentity): IssueTokenResult {
    return this.issue({
      sub: agent.id,
      identityType: "agent",
      roles: agent.roles,
      tenantId: agent.tenantId,
      name: agent.name,
    });
  }

  issue(
    claims: Omit<JWTPayload, "iat" | "exp" | "jti" | "iss" | "aud" | "type">,
  ): IssueTokenResult {
    const now = Math.floor(Date.now() / 1000);
    const accessTtlSec = Math.floor((this.config.accessTokenTtlMs ?? 900_000) / 1000);
    const refreshTtlSec = Math.floor((this.config.refreshTokenTtlMs ?? 604_800_000) / 1000);

    const accessPayload: JWTPayload = {
      ...claims,
      iss: this.config.issuer,
      aud: this.config.audience,
      iat: now,
      exp: now + accessTtlSec,
      jti: randomBytes(16).toString("hex"),
      type: "access",
    };

    const refreshPayload: JWTPayload = {
      ...claims,
      iss: this.config.issuer,
      aud: this.config.audience,
      iat: now,
      exp: now + refreshTtlSec,
      jti: randomBytes(16).toString("hex"),
      type: "refresh",
      roles: [], // refresh tokens carry no roles — they just issue new access tokens
    };

    const accessToken = this.encode(accessPayload);
    const refreshToken = this.encode(refreshPayload);

    // Persist the refresh token so session listing/revocation is not inert.
    // No-op when no store is wired (backward compatible for callers that only
    // mint short-lived tokens).
    this.tokenStore?.storeRefreshToken(
      refreshPayload.jti,
      refreshPayload.sub,
      refreshToken,
      refreshPayload.iat,
      refreshPayload.exp,
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: accessTtlSec,
      tokenType: "Bearer",
    };
  }

  /**
   * Decode and verify a JWT. Returns null if invalid, expired, revoked, or if
   * its issuer/audience/type do not match what this service enforces.
   *
   * @param opts.expectedType when set, the token's `type` must match exactly —
   *   e.g. pass "access" so a long-lived refresh token cannot be presented in
   *   place of an access token.
   */
  decode(token: string, opts?: { expectedType?: "access" | "refresh" }): JWTPayload | null {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;
    if (!header || !payload || !signature) return null;

    if (!verify(header, payload, signature, this.config)) return null;

    let decoded: JWTPayload;
    try {
      decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as JWTPayload;
    } catch {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    const SKEW_SEC = 60; // small leniency for not-before only; expiry stays strict
    if (decoded.exp < now) return null; // expired
    if (typeof decoded.nbf === "number" && decoded.nbf > now + SKEW_SEC) return null; // not yet valid

    // Enforce issuer/audience so tokens minted for a different issuer/audience
    // are rejected. issue() always populates iss/aud from config, so this is
    // backward compatible with tokens this service mints.
    if (decoded.iss !== this.config.issuer) return null;
    if (decoded.aud !== this.config.audience) return null;

    // Prevent a refresh token from being accepted where an access token is
    // required (and vice versa) when the caller declares its expectation.
    if (opts?.expectedType && decoded.type !== opts.expectedType) return null;

    // Reject explicitly revoked access tokens (force-logout / admin kill).
    if (decoded.jti && this.tokenStore?.isAccessTokenRevoked(decoded.jti)) return null;

    return decoded;
  }

  /**
   * Verify a token and require it to be an access token. Preferred entry point
   * for request authentication so refresh tokens are never accepted as access.
   */
  verifyAccessToken(token: string): JWTPayload | null {
    return this.decode(token, { expectedType: "access" });
  }

  private encode(payload: JWTPayload): string {
    const header = encodeHeader(this.config.algorithm);
    const body = encodePayload(payload);
    const sig = sign(`${header}.${body}`, this.config);
    return `${header}.${body}.${sig}`;
  }
}

// ── API key hashing ────────────────────────────────────────────────────────────

/**
 * Generate a new API key and its SHA-256 hash.
 * Returns the plaintext key (shown once) and hash (stored in DB).
 */
export function generateApiKey(prefix = "oc"): { key: string; hash: string } {
  const key = `${prefix}_${randomBytes(32).toString("base64url")}`;
  const hash = createHash("sha256").update(key).digest("hex");
  return { key, hash };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
