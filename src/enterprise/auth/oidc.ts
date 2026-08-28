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
  issuer?: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
  jwks_uri: string;
  /** Algorithms the IdP advertises for id_token signing (RFC 8414). */
  id_token_signing_alg_values_supported?: string[];
};

type TokenResponse = {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
};

import { createPublicKey, verify as cryptoVerify, constants as cryptoConstants } from "node:crypto";
import type { KeyObject } from "node:crypto";

async function fetchJson<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, opts);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  // fetchJson is the single typed boundary for trusted OIDC/IdP endpoints; res.json()
  // is Promise<any> and the caller's T is the provider's documented response schema.
  // SAFETY: T reflects the provider's documented discovery/JWKS/token/userinfo response.
  return res.json() as Promise<T>;
}

// ── JWKS verification ─────────────────────────────────────────────────────────

type JwkKey = {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string; // RSA modulus (base64url)
  e?: string; // RSA exponent (base64url)
  x5c?: string[]; // X.509 certificate chain
  crv?: string; // EC curve
  x?: string; // EC x
  y?: string; // EC y
};

type JwkSet = { keys: JwkKey[] };

// Cache keyed by jwksUri so each IdP's JWKS is stored independently — a module
// -global single-slot cache would serve one issuer's keys for another (cross
// -issuer/tenant key confusion).
const jwksCache = new Map<string, { keys: JwkKey[]; fetchedAt: number }>();
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchJwks(jwksUri: string, forceRefresh = false): Promise<JwkKey[]> {
  const now = Date.now();
  const cached = jwksCache.get(jwksUri);
  if (!forceRefresh && cached && now - cached.fetchedAt < JWKS_CACHE_TTL_MS) {
    return cached.keys;
  }
  const set = await fetchJson<JwkSet>(jwksUri);
  jwksCache.set(jwksUri, { keys: set.keys, fetchedAt: now });
  return set.keys;
}

/**
 * Build a public KeyObject from a JWK. Prefers an embedded X.509 cert (x5c);
 * otherwise imports the bare key material natively (RSA n/e, EC crv/x/y) via
 * Node's JWK support so IdPs that publish bare JWKS (Keycloak, Auth0, Azure)
 * verify instead of failing closed.
 */
function jwkToKeyObject(key: JwkKey): KeyObject {
  if (key.x5c && key.x5c[0]) {
    const pem =
      "-----BEGIN CERTIFICATE-----\n" +
      (key.x5c[0].match(/.{1,64}/g) ?? []).join("\n") +
      "\n-----END CERTIFICATE-----";
    return createPublicKey(pem);
  }
  if (key.kty === "RSA" && key.n && key.e) {
    return createPublicKey({ key: { kty: "RSA", n: key.n, e: key.e }, format: "jwk" });
  }
  if (key.kty === "EC" && key.crv && key.x && key.y) {
    return createPublicKey({
      key: { kty: "EC", crv: key.crv, x: key.x, y: key.y },
      format: "jwk",
    });
  }
  throw new Error(`Unsupported JWK: cannot build key material for kty=${key.kty}`);
}

// Allowlist of asymmetric signature algorithms we will verify. Symmetric algs
// (HS*) and "none" are intentionally absent: there is no shared-secret path for
// an id_token here, so accepting them would be a signature-bypass.
const RSA_ALGS: Record<string, string> = { RS256: "sha256", RS384: "sha384", RS512: "sha512" };
const PS_ALGS: Record<string, string> = { PS256: "sha256", PS384: "sha384", PS512: "sha512" };
const EC_ALGS: Record<string, string> = { ES256: "sha256", ES384: "sha384", ES512: "sha512" };

/**
 * Verify an ID token signature against the IdP's JWKS.
 * Returns the decoded payload if valid, throws if invalid.
 */
export async function verifyIdToken(
  idToken: string,
  jwksUri: string,
  expectedIssuer?: string,
  expectedAudience?: string,
  allowedAlgs?: string[],
): Promise<Record<string, unknown>> {
  const parts = idToken.split(".");
  const [headerB64, payloadB64, signatureB64] = parts;
  if (parts.length !== 3 || !headerB64 || !payloadB64 || !signatureB64) {
    throw new Error("Malformed JWT: expected 3 parts");
  }

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    // Every field read below uses guarded index access (typeof checks / optional
    // lookups), so a non-object payload degrades to `undefined` reads, not unsound access.
    // SAFETY: JSON.parse yields an arbitrary JSON value read only via guarded index access below.
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    // SAFETY: JSON.parse yields an arbitrary JSON value read only via guarded index access below.
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
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
    throw new Error(
      `ID token issuer mismatch: expected ${expectedIssuer}, got ${String(payload["iss"])}`,
    );
  }
  if (expectedAudience && payload["aud"] !== expectedAudience) {
    throw new Error("ID token audience mismatch");
  }

  const kid = typeof header["kid"] === "string" ? header["kid"] : undefined;
  const alg = typeof header["alg"] === "string" ? header["alg"] : undefined;

  if (!alg) {
    throw new Error("ID token header missing alg");
  }

  // Enforce an algorithm allowlist. This rejects alg:"none" and HS* confusion
  // outright. When the IdP advertises id_token_signing_alg_values_supported we
  // additionally require the token's alg to be one the IdP claims to use.
  const isSupported = alg in RSA_ALGS || alg in PS_ALGS || alg in EC_ALGS;
  if (!isSupported) {
    throw new Error(`Unsupported or insecure ID token alg: ${alg}`);
  }
  if (allowedAlgs && allowedAlgs.length > 0 && !allowedAlgs.includes(alg)) {
    throw new Error(`ID token alg ${alg} not advertised by IdP`);
  }

  const findKey = (keys: JwkKey[]): JwkKey | undefined =>
    kid ? keys.find((k) => k.kid === kid) : keys.find((k) => !k.use || k.use === "sig");

  let keys = await fetchJwks(jwksUri);
  let matchingKey = findKey(keys);
  // On a kid miss, force a single refresh (bypassing the TTL) to survive key
  // rotation before giving up.
  if (!matchingKey && kid) {
    keys = await fetchJwks(jwksUri, true);
    matchingKey = findKey(keys);
  }

  if (!matchingKey) {
    throw new Error(`No matching JWK found for kid=${kid ?? "any"}`);
  }

  // Verify signature using Node.js built-in crypto. Any alg that reaches here
  // is in the allowlist; we never return an unverified payload.
  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, "utf8");
  const signature = Buffer.from(signatureB64, "base64url");
  const keyObject = jwkToKeyObject(matchingKey);

  let valid = false;
  if (alg in RSA_ALGS) {
    valid = cryptoVerify(RSA_ALGS[alg], signingInput, keyObject, signature);
  } else if (alg in PS_ALGS) {
    valid = cryptoVerify(
      PS_ALGS[alg],
      signingInput,
      {
        key: keyObject,
        padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
        saltLength: cryptoConstants.RSA_PSS_SALTLEN_DIGEST,
      },
      signature,
    );
  } else {
    // EC (ES256/384/512): JWS carries the raw r||s signature (IEEE P1363).
    valid = cryptoVerify(
      EC_ALGS[alg],
      signingInput,
      { key: keyObject, dsaEncoding: "ieee-p1363" },
      signature,
    );
  }

  if (!valid) {
    throw new Error("ID token signature verification failed");
  }

  return payload;
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
    if (entry.expiresAt < now) {
      pendingLogins.delete(state);
    }
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
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }

  /** Generate the authorization redirect URL (PKCE). */
  getAuthorizationUrl(redirectAfter?: string): { url: string; state: string } {
    if (!this.discovery) {
      throw new Error("OidcService not initialized");
    }
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
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    redirectAfter?: string;
  }> {
    if (!this.discovery) {
      throw new Error("OidcService not initialized");
    }

    const pending = pendingLogins.get(stateParam);
    if (!pending) {
      throw Object.assign(new Error("Invalid or expired state"), { code: "INVALID_STATE" });
    }
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
          this.discovery.issuer,
          this.config.clientId,
          this.discovery.id_token_signing_alg_values_supported,
        )
      : await fetchJson<Record<string, unknown>>(this.discovery.userinfo_endpoint!, {
          headers: { Authorization: `Bearer ${tokenResp.access_token}` },
        });

    const emailClaim = this.config.emailClaim ?? "email";
    const nameClaim = this.config.nameClaim ?? "name";
    const groupsClaim = this.config.groupsClaim ?? "groups";

    const emailRaw = claims[emailClaim];
    const email = typeof emailRaw === "string" ? emailRaw : undefined;
    const nameRaw = claims[nameClaim];
    const name = typeof nameRaw === "string" ? nameRaw : undefined;
    const sub = typeof claims["sub"] === "string" ? claims["sub"] : "";
    const externalId = sub || email || "";
    const rawGroups = claims[groupsClaim];
    const idpGroups: string[] = Array.isArray(rawGroups)
      ? rawGroups.filter((g): g is string => typeof g === "string")
      : typeof rawGroups === "string"
        ? [rawGroups]
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
      ...user,
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
    if (!updatedUser) {
      throw new Error("Failed to provision OIDC user");
    }

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
          res.end(
            JSON.stringify({ error, description: url.searchParams.get("error_description") }),
          );
          return;
        }

        const result = await service.handleCallback(code, state);

        // Return tokens as JSON (UI stores them via device-auth mechanism)
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            expiresIn: result.expiresIn,
          }),
        );
      } catch (err) {
        // err is unknown in the catch clause; a non-matching shape yields undefined and
        // falls through to a 500, so the cast cannot mis-handle a genuine error.
        // SAFETY: reading an optional string `code` off an unknown error is defensive; undefined → 500.
        const code = (err as { code?: string }).code === "INVALID_STATE" ? 400 : 500;
        res.writeHead(code);
        res.end(JSON.stringify({ error: String(err) }));
      }
    },
  };
}

// ── OIDC provider presets ──────────────────────────────────────────────────────

export type OidcProviderPreset = "palantir" | "okta" | "azure-ad" | "google" | "auth0" | "keycloak";

export type OidcPresetParams = {
  provider: OidcProviderPreset;
  stackUrl?: string;
  tenantId?: string;
  realm?: string;
};

const OIDC_PROVIDER_PRESETS: Record<OidcProviderPreset, (params: OidcPresetParams) => string> = {
  palantir: (p) => {
    if (!p.stackUrl) {
      throw new Error("OIDC provider 'palantir' requires stackUrl");
    }
    return `${p.stackUrl}/.well-known/openid-configuration`;
  },
  okta: (p) => {
    if (!p.stackUrl) {
      throw new Error("OIDC provider 'okta' requires stackUrl");
    }
    return `${p.stackUrl}/.well-known/openid-configuration`;
  },
  "azure-ad": (p) => {
    if (!p.tenantId) {
      throw new Error("OIDC provider 'azure-ad' requires tenantId");
    }
    return `https://login.microsoftonline.com/${p.tenantId}/v2.0/.well-known/openid-configuration`;
  },
  google: () => {
    return "https://accounts.google.com/.well-known/openid-configuration";
  },
  auth0: (p) => {
    if (!p.stackUrl) {
      throw new Error("OIDC provider 'auth0' requires stackUrl");
    }
    return `${p.stackUrl}/.well-known/openid-configuration`;
  },
  keycloak: (p) => {
    if (!p.stackUrl) {
      throw new Error("OIDC provider 'keycloak' requires stackUrl");
    }
    if (!p.realm) {
      throw new Error("OIDC provider 'keycloak' requires realm");
    }
    return `${p.stackUrl}/realms/${p.realm}/.well-known/openid-configuration`;
  },
};

/**
 * Resolve the OIDC discovery URL from either an explicit discoveryUrl or a provider preset.
 * If both are set, discoveryUrl takes precedence.
 */
export function resolveOidcDiscoveryUrl(params: {
  discoveryUrl?: string;
  provider?: string;
  stackUrl?: string;
  tenantId?: string;
  realm?: string;
}): string {
  if (params.discoveryUrl) {
    return params.discoveryUrl;
  }

  if (!params.provider) {
    throw new Error("Either discoveryUrl or provider must be set in OIDC config");
  }

  // SAFETY: indexing the presets map with an arbitrary provider string yields `undefined` for an unknown key, which the guard below rejects before any call.
  const presetFn = OIDC_PROVIDER_PRESETS[params.provider as OidcProviderPreset];
  if (!presetFn) {
    throw new Error(
      `Unknown OIDC provider '${params.provider}'. Valid providers: ${Object.keys(OIDC_PROVIDER_PRESETS).join(", ")}`,
    );
  }

  return presetFn({
    // SAFETY: the presetFn lookup above succeeded, so params.provider is one of the OidcProviderPreset keys.
    provider: params.provider as OidcProviderPreset,
    stackUrl: params.stackUrl,
    tenantId: params.tenantId,
    realm: params.realm,
  });
}

// ── Factory ────────────────────────────────────────────────────────────────────

export async function initOidc(cfg: OpenClawConfig, iam: IAMHandle): Promise<OidcService | null> {
  // The config schema types this node as the OIDC config shape.
  // SAFETY: the required fields (discoveryUrl, clientId) are re-checked below before the service is built.
  const oidcCfg = cfg.enterprise?.auth?.oidc as OidcConfig | undefined;
  if (!oidcCfg?.discoveryUrl || !oidcCfg.clientId) {
    return null;
  }

  const service = new OidcService(oidcCfg, iam);
  await service.initialize();
  return service;
}
