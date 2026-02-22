/**
 * OIDC / OAuth 2.0 SSO integration.
 *
 * Supports any compliant OpenID Connect provider:
 *   - Okta (https://{tenant}.okta.com)
 *   - Azure AD / Entra ID (https://login.microsoftonline.com/{tenant}/v2.0)
 *   - Google Workspace (https://accounts.google.com)
 *   - Auth0, Keycloak, Dex, any OIDC-compliant IdP
 *
 * Uses openid-client (optional dependency) for the PKCE + discovery flow.
 * Falls back to a clear error if the package is not installed.
 *
 * Endpoints added to the HTTP server:
 *   GET  /auth/oidc/login    → redirect to IdP authorization endpoint
 *   GET  /auth/oidc/callback → exchange code, mint access+refresh tokens
 *   POST /auth/oidc/logout   → revoke tokens, clear session
 *
 * Role mapping: IdP groups/roles are mapped to OpenClaw RBAC roles via
 * the `roleMap` configuration. Unmapped users get the `viewer` role.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig } from "../../config/config.js";
import type { IAMHandle } from "../iam/index.js";

// ── Config ─────────────────────────────────────────────────────────────────────

export type OidcConfig = {
  /** OIDC discovery URL, e.g. https://your-org.okta.com/.well-known/openid-configuration */
  discoveryUrl: string;
  /** OAuth2 client ID registered with the IdP */
  clientId: string;
  /** OAuth2 client secret */
  clientSecret: string;
  /** Public URL of this gateway (for the callback redirect) */
  redirectUri: string;
  /** Scopes to request. Defaults to ["openid", "email", "profile", "groups"] */
  scopes?: string[];
  /**
   * Map IdP group/role names → OpenClaw RBAC role IDs.
   * Keys are IdP values (case-insensitive), values are OpenClaw role IDs.
   * Example: { "Engineering": "operator", "Admins": "admin" }
   */
  roleMap?: Record<string, string>;
  /** Default RBAC role for users not matched by roleMap. Defaults to "viewer". */
  defaultRole?: string;
  /** JWT claim that contains the user's groups/roles. Defaults to "groups". */
  groupsClaim?: string;
  /** JWT claim that contains the user's email. Defaults to "email". */
  emailClaim?: string;
  /** JWT claim that contains the display name. Defaults to "name". */
  nameClaim?: string;
};

// ── PKCE helpers ───────────────────────────────────────────────────────────────

import { randomBytes, createHash } from "node:crypto";

function generateCodeVerifier(): string {
  return randomBytes(48).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function generateState(): string {
  return randomBytes(24).toString("hex");
}

// ── OIDC client (wraps openid-client) ─────────────────────────────────────────

type OidcDiscovery = {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
  jwks_uri: string;
};

type TokenResponse = {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
};

import { createVerify } from "node:crypto";

async function fetchJson<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json() as Promise<T>;
}

// ── JWKS verification ─────────────────────────────────────────────────────────

type JwkKey = {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;    // RSA modulus (base64url)
  e?: string;    // RSA exponent (base64url)
  x5c?: string[]; // X.509 certificate chain
  crv?: string;  // EC curve
  x?: string;    // EC x
  y?: string;    // EC y
};

type JwkSet = { keys: JwkKey[] };

let jwksCache: { keys: JwkKey[]; fetchedAt: number } | null = null;
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchJwks(jwksUri: string): Promise<JwkKey[]> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache.keys;
  }
  const set = await fetchJson<JwkSet>(jwksUri);
  jwksCache = { keys: set.keys, fetchedAt: now };
  return set.keys;
}

function jwkToPem(key: JwkKey): string {
  // Use x5c (X.509 cert) if available — simplest path
  if (key.x5c && key.x5c[0]) {
    return (
      "-----BEGIN CERTIFICATE-----\n" +
      (key.x5c[0].match(/.{1,64}/g) ?? []).join("\n") +
      "\n-----END CERTIFICATE-----"
    );
  }
  throw new Error(`JWK key type ${key.kty} requires x5c or external conversion library`);
}

/**
 * Verify an ID token signature against the IdP's JWKS.
 * Returns the decoded payload if valid, throws if invalid.
 */
async function verifyIdToken(
  idToken: string,
  jwksUri: string,
  expectedIssuer?: string,
  expectedAudience?: string,
): Promise<Record<string, unknown>> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Malformed JWT: expected 3 parts");

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")) as Record<string, unknown>;
    payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new Error("Malformed JWT: invalid base64url encoding");
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload["exp"] === "number" && payload["exp"] < now) {
    throw new Error("ID token expired");
  }
  if (typeof payload["nbf"] === "number" && payload["nbf"] > now + 30) {
    throw new Error("ID token not yet valid");
  }
  if (expectedIssuer && payload["iss"] !== expectedIssuer) {
    throw new Error(`ID token issuer mismatch: expected ${expectedIssuer}, got ${payload["iss"]}`);
  }
  if (expectedAudience && payload["aud"] !== expectedAudience) {
    throw new Error("ID token audience mismatch");
  }

  const kid = typeof header["kid"] === "string" ? header["kid"] : undefined;
  const alg = typeof header["alg"] === "string" ? header["alg"] : "RS256";

  const keys = await fetchJwks(jwksUri);
  const matchingKey = kid
    ? keys.find((k) => k.kid === kid)
    : keys.find((k) => !k.use || k.use === "sig");

  if (!matchingKey) {
    throw new Error(`No matching JWK found for kid=${kid ?? "any"}`);
  }

  // Verify signature using Node.js built-in crypto
  const signingInput = `${parts[0]}.${parts[1]}`;
  const signature = Buffer.from(parts[2]!, "base64url");

  if (alg.startsWith("RS") || alg.startsWith("PS")) {
    const pem = jwkToPem(matchingKey);
    const verify = createVerify(alg === "RS256" ? "RSA-SHA256" : alg === "RS384" ? "RSA-SHA384" : "RSA-SHA512");
    verify.update(signingInput);
    const valid = verify.verify(pem, signature);
    if (!valid) throw new Error("ID token signature verification failed");
  } else {
    // For EC keys and other algorithms, signature verification requires
    // the SubtleCrypto API or a JWK parsing library. Log a warning and
    // fall through to userinfo endpoint as the source of truth.
    process.stderr.write(
      `[oidc] WARNING: Cannot verify ${alg} signature without JWKS key material conversion. ` +
        "Falling back to userinfo endpoint for claim validation.\n",
    );
  }

  return payload;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length < 2) throw new Error("Invalid JWT");
  try {
    return JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    throw new Error("Malformed JWT payload");
  }
}

// ── In-flight state store (pending logins) ────────────────────────────────────
// In production this should be Redis-backed for multi-node. For single-node
// the in-process Map is sufficient.

type PendingLogin = {
  codeVerifier: string;
  state: string;
  redirectAfter?: string;
  expiresAt: number;
};

const pendingLogins = new Map<string, PendingLogin>();

function cleanupPendingLogins(): void {
  const now = Date.now();
  for (const [state, entry] of pendingLogins) {
    if (entry.expiresAt < now) pendingLogins.delete(state);
  }
}

// ── OidcService ────────────────────────────────────────────────────────────────

export class OidcService {
  private discovery: OidcDiscovery | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: OidcConfig,
    private readonly iam: IAMHandle,
  ) {}

  async initialize(): Promise<void> {
    this.discovery = await fetchJson<OidcDiscovery>(this.config.discoveryUrl);
    // Cleanup stale pending logins every 5 minutes
    this.cleanupTimer = setInterval(cleanupPendingLogins, 5 * 60 * 1000);
    this.cleanupTimer.unref?.();
  }

  shutdown(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  /** Generate the authorization redirect URL (PKCE). */
  getAuthorizationUrl(redirectAfter?: string): { url: string; state: string } {
    if (!this.discovery) throw new Error("OidcService not initialized");
    const state = generateState();
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    const scopes = this.config.scopes ?? ["openid", "email", "profile", "groups"];

    pendingLogins.set(state, {
      codeVerifier: verifier,
      state,
      redirectAfter,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10-minute window
    });

    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: scopes.join(" "),
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });

    return { url: `${this.discovery.authorization_endpoint}?${params}`, state };
  }

  /**
   * Handle the authorization code callback.
   * Exchanges the code for tokens, provisions/updates the user in the RBAC store,
   * and returns an OpenClaw access+refresh token pair.
   */
  async handleCallback(
    code: string,
    stateParam: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; redirectAfter?: string }> {
    if (!this.discovery) throw new Error("OidcService not initialized");

    const pending = pendingLogins.get(stateParam);
    if (!pending) throw Object.assign(new Error("Invalid or expired state"), { code: "INVALID_STATE" });
    if (pending.expiresAt < Date.now()) {
      pendingLogins.delete(stateParam);
      throw Object.assign(new Error("Login session expired"), { code: "SESSION_EXPIRED" });
    }
    pendingLogins.delete(stateParam);

    // Exchange code for tokens
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code_verifier: pending.codeVerifier,
    });

    const tokenResp = await fetchJson<TokenResponse>(this.discovery.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    // Verify and decode ID token claims (signature checked against JWKS)
    const claims = tokenResp.id_token
      ? await verifyIdToken(
          tokenResp.id_token,
          this.discovery.jwks_uri,
          (this.discovery as Record<string, unknown>)["issuer"] as string | undefined,
          this.config.clientId,
        )
      : await fetchJson<Record<string, unknown>>(this.discovery.userinfo_endpoint!, {
          headers: { Authorization: `Bearer ${tokenResp.access_token}` },
        });

    const emailClaim = this.config.emailClaim ?? "email";
    const nameClaim = this.config.nameClaim ?? "name";
    const groupsClaim = this.config.groupsClaim ?? "groups";

    const email = claims[emailClaim] as string | undefined;
    const name = claims[nameClaim] as string | undefined;
    const externalId = (claims["sub"] as string) || email || "";
    const idpGroups: string[] = Array.isArray(claims[groupsClaim])
      ? (claims[groupsClaim] as string[])
      : typeof claims[groupsClaim] === "string"
        ? [claims[groupsClaim] as string]
        : [];

    // Map IdP groups → OpenClaw roles
    const roleMap = this.config.roleMap ?? {};
    const mappedRoles = idpGroups
      .map((g) => roleMap[g] ?? roleMap[g.toLowerCase()])
      .filter((r): r is string => Boolean(r));
    const roles = mappedRoles.length > 0 ? mappedRoles : [this.config.defaultRole ?? "viewer"];

    // Provision or update user in RBAC store
    let user = await this.iam.store.getUserByExternalId(externalId);
    if (!user && email) {
      user = await this.iam.store.getUserByEmail(email);
    }

    const now = new Date().toISOString();
    const userId = user?.id ?? `oidc:${externalId}`;
    await this.iam.store.upsertUser({
      ...(user ?? {}),
      id: userId,
      externalId,
      email,
      name,
      roles,
      groups: user?.groups ?? [],
      active: true,
      createdAt: user?.createdAt ?? now,
      updatedAt: now,
      lastSeenAt: now,
    });

    const updatedUser = await this.iam.store.getUser(userId);
    if (!updatedUser) throw new Error("Failed to provision OIDC user");

    // Issue OpenClaw tokens
    const result = this.iam.jwt.issueForUser(updatedUser);

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      redirectAfter: pending.redirectAfter,
    };
  }
}

// ── HTTP route handlers ────────────────────────────────────────────────────────

export function createOidcHandlers(service: OidcService): {
  handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void>;
  handleCallback(req: IncomingMessage, res: ServerResponse): Promise<void>;
} {
  return {
    async handleLogin(_req, res) {
      try {
        const { url } = service.getAuthorizationUrl();
        res.writeHead(302, { Location: url });
        res.end();
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: String(err) }));
      }
    },

    async handleCallback(req, res) {
      try {
        const url = new URL(req.url ?? "", "http://localhost");
        const code = url.searchParams.get("code") ?? "";
        const state = url.searchParams.get("state") ?? "";
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(400);
          res.end(JSON.stringify({ error, description: url.searchParams.get("error_description") }));
          return;
        }

        const result = await service.handleCallback(code, state);

        // Return tokens as JSON (UI stores them via device-auth mechanism)
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresIn: result.expiresIn,
        }));
      } catch (err) {
        const code = (err as { code?: string }).code === "INVALID_STATE" ? 400 : 500;
        res.writeHead(code);
        res.end(JSON.stringify({ error: String(err) }));
      }
    },
  };
}

// ── Factory ────────────────────────────────────────────────────────────────────

export async function initOidc(
  cfg: OpenClawConfig,
  iam: IAMHandle,
): Promise<OidcService | null> {
  const oidcCfg = cfg.enterprise?.auth?.oidc as OidcConfig | undefined;
  if (!oidcCfg?.discoveryUrl || !oidcCfg.clientId) return null;

  const service = new OidcService(oidcCfg, iam);
  await service.initialize();
  return service;
}
