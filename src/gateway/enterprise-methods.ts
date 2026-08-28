/**
 * Enterprise gateway RPC method handlers.
 *
 * Registered as aux gateway methods (owner kind "aux") through the attached
 * extra-handler table in server-core-runtime.ts, which assigns them the
 * operator admin scope by default — every enterprise.* method is admin-only.
 *
 * Handlers respond with UNAVAILABLE while the enterprise subsystem is not
 * initialized (enterprise config absent or initEnterprise failed).
 */

import { ErrorCodes, errorShape } from "../../packages/gateway-protocol/src/index.js";
import { lazyCompile } from "../../packages/gateway-protocol/src/protocol-validator.js";
import { getAuditStorage } from "../enterprise/audit/logger.js";
import type { AuditStorage } from "../enterprise/audit/storage/sqlite.js";
import { MfaService } from "../enterprise/auth/mfa.js";
import type { TokenStore } from "../enterprise/auth/token-store.js";
import { gdprEraseUser, gdprExportUser } from "../enterprise/iam/gdpr.js";
import { getIAMHandle } from "../enterprise/iam/index.js";
import type { RBACEngine } from "../enterprise/iam/rbac/engine.js";
import type { User } from "../enterprise/iam/rbac/model.js";
import type { RBACStore } from "../enterprise/iam/rbac/store.js";
import { IpAllowlist } from "../enterprise/security/ip-allowlist.js";
import {
  EnterpriseAuditExportParamsSchema,
  EnterpriseAuditQueryParamsSchema,
  EnterpriseGdprEraseParamsSchema,
  EnterpriseGdprExportParamsSchema,
  EnterpriseIpAllowlistCheckParamsSchema,
  EnterpriseMfaConfirmEnrollParamsSchema,
  EnterpriseMfaDisableParamsSchema,
  EnterpriseMfaEnrollParamsSchema,
  EnterpriseMfaVerifyParamsSchema,
  EnterpriseRolesListParamsSchema,
  EnterpriseSessionRevokeParamsSchema,
  EnterpriseSessionsListParamsSchema,
  EnterpriseUserDeleteParamsSchema,
  EnterpriseUserGetParamsSchema,
  EnterpriseUsersListParamsSchema,
  EnterpriseUserUpsertParamsSchema,
} from "./protocol/schema/enterprise.js";
import type { GatewayRequestHandler, GatewayRequestHandlers } from "./server-methods/types.js";
import { assertValidParams, type Validator } from "./server-methods/validation.js";

// ── Param validators (lazily compiled from the protocol schemas) ──────────────

const validateUsersListParams = lazyCompile(EnterpriseUsersListParamsSchema);
const validateUserGetParams = lazyCompile(EnterpriseUserGetParamsSchema);
const validateUserUpsertParams = lazyCompile(EnterpriseUserUpsertParamsSchema);
const validateUserDeleteParams = lazyCompile(EnterpriseUserDeleteParamsSchema);
const validateRolesListParams = lazyCompile(EnterpriseRolesListParamsSchema);
const validateSessionsListParams = lazyCompile(EnterpriseSessionsListParamsSchema);
const validateSessionRevokeParams = lazyCompile(EnterpriseSessionRevokeParamsSchema);
const validateAuditQueryParams = lazyCompile(EnterpriseAuditQueryParamsSchema);
const validateAuditExportParams = lazyCompile(EnterpriseAuditExportParamsSchema);
const validateGdprExportParams = lazyCompile(EnterpriseGdprExportParamsSchema);
const validateGdprEraseParams = lazyCompile(EnterpriseGdprEraseParamsSchema);
const validateMfaEnrollParams = lazyCompile(EnterpriseMfaEnrollParamsSchema);
const validateMfaVerifyParams = lazyCompile(EnterpriseMfaVerifyParamsSchema);
const validateMfaConfirmEnrollParams = lazyCompile(EnterpriseMfaConfirmEnrollParamsSchema);
const validateMfaDisableParams = lazyCompile(EnterpriseMfaDisableParamsSchema);
const validateIpAllowlistCheckParams = lazyCompile(EnterpriseIpAllowlistCheckParamsSchema);

// ── Helpers ───────────────────────────────────────────────────────────────────

class EnterpriseNotInitializedError extends Error {}

function requireIAM(): { store: RBACStore; rbac: RBACEngine; tokens: TokenStore | null } {
  const h = getIAMHandle();
  if (!h) {
    throw new EnterpriseNotInitializedError("Enterprise IAM not initialized");
  }
  return { store: h.store, rbac: h.rbac, tokens: h.tokens };
}

function requireAudit(): AuditStorage {
  const s = getAuditStorage();
  if (!s) {
    throw new EnterpriseNotInitializedError("Enterprise audit not initialized");
  }
  return s;
}

function enterpriseErrorShape(method: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof EnterpriseNotInitializedError) {
    return errorShape(ErrorCodes.UNAVAILABLE, `${method}: ${message}`);
  }
  const code = (error as { code?: unknown } | null)?.code;
  return errorShape(
    ErrorCodes.INVALID_REQUEST,
    `${method}: ${message}`,
    typeof code === "string" ? { details: { code } } : undefined,
  );
}

/** Binds one enterprise method to its schema validator and error mapping. */
function enterpriseMethod<T>(
  method: string,
  validate: Validator<T>,
  run: (params: T) => Promise<unknown>,
): GatewayRequestHandler {
  return async ({ params, respond }) => {
    if (!assertValidParams(params, validate, method, respond)) {
      return;
    }
    try {
      respond(true, await run(params));
    } catch (error) {
      respond(false, undefined, enterpriseErrorShape(method, error));
    }
  };
}

function notFound(what: string): Error {
  return Object.assign(new Error(`${what} not found`), { code: "NOT_FOUND" });
}

// ── Handlers ──────────────────────────────────────────────────────────────────

export const enterpriseHandlers: GatewayRequestHandlers = {
  // ── Users ───────────────────────────────────────────────────────────────────

  "enterprise.users.list": enterpriseMethod(
    "enterprise.users.list",
    validateUsersListParams,
    async (params) => {
      const { store } = requireIAM();
      const all = await store.listUsers(params.tenantId);
      const limit = params.limit ?? 100;
      const offset = params.offset ?? 0;
      const page = all.slice(offset, offset + limit);
      return {
        users: page.map(userToWire),
        total: all.length,
      };
    },
  ),

  "enterprise.users.get": enterpriseMethod(
    "enterprise.users.get",
    validateUserGetParams,
    async (params) => {
      const { store } = requireIAM();
      const user = await store.getUser(params.userId);
      if (!user) {
        throw notFound("User");
      }
      return userToWire(user);
    },
  ),

  "enterprise.users.upsert": enterpriseMethod(
    "enterprise.users.upsert",
    validateUserUpsertParams,
    async (params) => {
      const { store } = requireIAM();
      const existing = await store.getUser(params.id);
      const now = new Date().toISOString();
      const user: User = {
        ...(existing ?? {}),
        id: params.id,
        name: params.name,
        email: params.email,
        roles: params.roles,
        groups: params.groups ?? existing?.groups ?? [],
        tenantId: params.tenantId,
        active: params.active,
        allowedCidrs: params.allowedCidrs,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await store.upsertUser(user);
      return { ok: true as const };
    },
  ),

  "enterprise.users.delete": enterpriseMethod(
    "enterprise.users.delete",
    validateUserDeleteParams,
    async (params) => {
      const { store } = requireIAM();
      await store.deleteUser(params.userId);
      return { ok: true as const };
    },
  ),

  // ── Roles ───────────────────────────────────────────────────────────────────

  "enterprise.roles.list": enterpriseMethod(
    "enterprise.roles.list",
    validateRolesListParams,
    async () => {
      const { store } = requireIAM();
      const roles = await store.listRoles();
      return {
        roles: roles.map((r) => ({
          id: r.id,
          displayName: r.displayName ?? r.id,
          permissions: r.permissions,
          builtIn: r.builtIn ?? false,
        })),
      };
    },
  ),

  // ── Sessions ────────────────────────────────────────────────────────────────

  "enterprise.sessions.list": enterpriseMethod(
    "enterprise.sessions.list",
    validateSessionsListParams,
    async (params) => {
      const { tokens } = requireIAM();
      if (!tokens) {
        return { sessions: [] };
      }
      const sessions = tokens.listActiveSessions(params.subjectId);
      return { sessions };
    },
  ),

  "enterprise.sessions.revoke": enterpriseMethod(
    "enterprise.sessions.revoke",
    validateSessionRevokeParams,
    async (params) => {
      const { tokens } = requireIAM();
      if (!tokens) {
        return { revoked: 0 };
      }
      if (params.jti) {
        tokens.revokeRefreshToken(params.jti);
        return { revoked: 1 };
      }
      if (params.subjectId) {
        const count = tokens.revokeAllForSubject(params.subjectId);
        return { revoked: count };
      }
      throw new Error("Provide jti or subjectId");
    },
  ),

  // ── Audit ───────────────────────────────────────────────────────────────────

  "enterprise.audit.query": enterpriseMethod(
    "enterprise.audit.query",
    validateAuditQueryParams,
    async (params) => {
      const audit = requireAudit();
      const { events, total } = await audit.query({
        actorId: params.actorId,
        category: params.category,
        action: params.action,
        outcome: params.outcome,
        tenantId: params.tenantId,
        from: params.from,
        until: params.until,
        search: params.search,
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      });
      return {
        events: events.map((e) => ({
          id: e.id,
          timestamp: e.timestamp,
          actorId: e.actor.id,
          actorEmail: e.actor.email,
          action: e.action,
          category: e.category,
          outcome: e.outcome,
          resourceId: e.resource?.id,
          resourceType: e.resource?.type,
          tenantId: e.actor.tenantId,
          errorMessage: e.errorMessage,
          durationMs: e.durationMs,
        })),
        total,
      };
    },
  ),

  "enterprise.audit.export": enterpriseMethod(
    "enterprise.audit.export",
    validateAuditExportParams,
    async (params) => {
      const audit = requireAudit();
      const { events } = await audit.query({
        from: params.from,
        until: params.until,
        tenantId: params.tenantId,
        limit: 10_000,
        offset: 0,
      });
      const data =
        params.format === "ndjson"
          ? events.map((e) => JSON.stringify(e)).join("\n")
          : JSON.stringify(events, null, 2);
      return { data };
    },
  ),

  // ── GDPR ────────────────────────────────────────────────────────────────────

  "enterprise.gdpr.export": enterpriseMethod(
    "enterprise.gdpr.export",
    validateGdprExportParams,
    async (params) => {
      const { store } = requireIAM();
      const audit = getAuditStorage();
      const data = await gdprExportUser(params.userId, store, audit ?? undefined);
      return { data };
    },
  ),

  "enterprise.gdpr.erase": enterpriseMethod(
    "enterprise.gdpr.erase",
    validateGdprEraseParams,
    async (params) => {
      const { store, tokens } = requireIAM();
      const audit = getAuditStorage();
      return await gdprEraseUser(params.userId, store, tokens ?? undefined, audit ?? undefined);
    },
  ),

  // ── MFA ─────────────────────────────────────────────────────────────────────

  "enterprise.mfa.enroll": enterpriseMethod(
    "enterprise.mfa.enroll",
    validateMfaEnrollParams,
    async (params) => {
      const { store } = requireIAM();
      const user = await store.getUser(params.userId);
      if (!user) {
        throw notFound("User");
      }
      return MfaService.generateEnrollment(user.id, user.email);
    },
  ),

  "enterprise.mfa.verify": enterpriseMethod(
    "enterprise.mfa.verify",
    validateMfaVerifyParams,
    async (params) => {
      const { store } = requireIAM();
      const user = await store.getUser(params.userId);
      if (!user) {
        throw notFound("User");
      }
      if (!user.totpSecret) {
        return { ok: false };
      }
      const ok = MfaService.verify(user.totpSecret, params.code);
      return { ok };
    },
  ),

  "enterprise.mfa.confirm-enroll": enterpriseMethod(
    "enterprise.mfa.confirm-enroll",
    validateMfaConfirmEnrollParams,
    async (params) => {
      const { store } = requireIAM();
      const user = await store.getUser(params.userId);
      if (!user) {
        throw notFound("User");
      }
      const ok = MfaService.verify(params.secret, params.code);
      if (!ok) {
        throw Object.assign(new Error("Invalid TOTP code"), { code: "INVALID_CODE" });
      }
      await store.upsertUser({ ...user, totpSecret: params.secret, mfaEnabled: true });
      return { ok: true as const };
    },
  ),

  "enterprise.mfa.disable": enterpriseMethod(
    "enterprise.mfa.disable",
    validateMfaDisableParams,
    async (params) => {
      const { store } = requireIAM();
      const user = await store.getUser(params.userId);
      if (!user) {
        throw notFound("User");
      }
      await store.upsertUser({ ...user, totpSecret: undefined, mfaEnabled: false });
      return { ok: true as const };
    },
  ),

  // ── IP allowlist ────────────────────────────────────────────────────────────

  "enterprise.ip-allowlist.check": enterpriseMethod(
    "enterprise.ip-allowlist.check",
    validateIpAllowlistCheckParams,
    async (params) => {
      const { store } = requireIAM();
      const user = await store.getUser(params.userId);
      if (!user) {
        return { allowed: false, reason: "User not found" };
      }
      const allowed = IpAllowlist.isAllowed(params.ipAddress, user.allowedCidrs);
      return { allowed, reason: allowed ? "ok" : "IP not in allowlist" };
    },
  ),
};

// ── Wire shape ────────────────────────────────────────────────────────────────

function userToWire(u: User) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    roles: u.roles ?? [],
    groups: u.groups ?? [],
    tenantId: u.tenantId,
    active: u.active ?? true,
    createdAt: u.createdAt,
    lastSeenAt: u.lastSeenAt,
    mfaEnabled: u.mfaEnabled ?? false,
    allowedCidrs: u.allowedCidrs,
  };
}
