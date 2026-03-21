/**
 * Enterprise gateway RPC method handlers.
 *
 * All methods are gated behind the "admin" role (enforced by the RBAC check
 * in the gateway dispatcher before reaching these handlers).
 *
 * Registration: call registerEnterpriseMethods(server) once during boot.
 */

import type { RBACStore } from "../enterprise/iam/rbac/store.js";
import type { RBACEngine } from "../enterprise/iam/rbac/engine.js";
import type { TokenStore } from "../enterprise/auth/token-store.js";
import type { AuditStorage } from "../enterprise/audit/storage/sqlite.js";
import { getIAMHandle } from "../enterprise/iam/index.js";
import { getAuditStorage } from "../enterprise/audit/logger.js";
import { MfaService } from "../enterprise/auth/mfa.js";
import { IpAllowlist } from "../enterprise/security/ip-allowlist.js";
import { gdprExportUser, gdprEraseUser } from "../enterprise/iam/gdpr.js";
import type { User } from "../enterprise/iam/rbac/model.js";

// ── Gateway server interface (minimal subset we depend on) ────────────────────

type MethodContext = {
  connId: string;
  actorId?: string;
  actorEmail?: string;
  tenantId?: string;
  roles?: string[];
  ipAddress?: string;
};

type MethodHandler<P, R> = (params: P, ctx: MethodContext) => Promise<R>;

type GatewayServer = {
  registerMethod<P, R>(method: string, handler: MethodHandler<P, R>): void;
};

// ── Helper: require IAM handle ────────────────────────────────────────────────

function requireIAM(): { store: RBACStore; rbac: RBACEngine; tokens: TokenStore | null } {
  const h = getIAMHandle();
  if (!h) {throw new Error("Enterprise IAM not initialized");}
  return { store: h.store, rbac: h.rbac, tokens: h.tokens };
}

function requireAudit(): AuditStorage {
  const s = getAuditStorage();
  if (!s) {throw new Error("Enterprise audit not initialized");}
  return s;
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerEnterpriseMethods(server: GatewayServer): void {
  // ── Users ──────────────────────────────────────────────────────────────────

  server.registerMethod("enterprise.users.list", async (params: {
    tenantId?: string;
    limit?: number;
    offset?: number;
  }) => {
    const { store } = requireIAM();
    const all = await store.listUsers(params.tenantId);
    const limit = params.limit ?? 100;
    const offset = params.offset ?? 0;
    const page = all.slice(offset, offset + limit);
    return {
      users: page.map(userToWire),
      total: all.length,
    };
  });

  server.registerMethod("enterprise.users.get", async (params: { userId: string }) => {
    const { store } = requireIAM();
    const user = await store.getUser(params.userId);
    if (!user) {throw Object.assign(new Error("User not found"), { code: "NOT_FOUND" });}
    return userToWire(user);
  });

  server.registerMethod("enterprise.users.upsert", async (params: {
    id: string;
    name?: string;
    email?: string;
    roles: string[];
    groups?: string[];
    tenantId?: string;
    active: boolean;
    allowedCidrs?: string[];
  }) => {
    const { store } = requireIAM();
    const existing = await store.getUser(params.id);
    const now = new Date().toISOString();
    const user: User = {
      ...existing,
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
  });

  server.registerMethod("enterprise.users.delete", async (params: { userId: string }) => {
    const { store } = requireIAM();
    await store.deleteUser(params.userId);
    return { ok: true as const };
  });

  // ── Roles ──────────────────────────────────────────────────────────────────

  server.registerMethod("enterprise.roles.list", async () => {
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
  });

  // ── Sessions ───────────────────────────────────────────────────────────────

  server.registerMethod("enterprise.sessions.list", async (params: { subjectId: string }) => {
    const { tokens } = requireIAM();
    if (!tokens) {return { sessions: [] };}
    const sessions = tokens.listActiveSessions(params.subjectId);
    return { sessions };
  });

  server.registerMethod("enterprise.sessions.revoke", async (params: {
    jti?: string;
    subjectId?: string;
  }) => {
    const { tokens } = requireIAM();
    if (!tokens) {return { revoked: 0 };}

    if (params.jti) {
      tokens.revokeRefreshToken(params.jti);
      return { revoked: 1 };
    }
    if (params.subjectId) {
      const count = tokens.revokeAllForSubject(params.subjectId);
      return { revoked: count };
    }
    throw new Error("Provide jti or subjectId");
  });

  // ── Audit ──────────────────────────────────────────────────────────────────

  server.registerMethod("enterprise.audit.query", async (params: {
    actorId?: string;
    category?: string;
    action?: string;
    outcome?: string;
    tenantId?: string;
    from?: string;
    until?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) => {
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
  });

  server.registerMethod("enterprise.audit.export", async (params: {
    format: "json" | "ndjson";
    from?: string;
    until?: string;
    tenantId?: string;
  }) => {
    const audit = requireAudit();
    const { events } = await audit.query({
      from: params.from,
      until: params.until,
      tenantId: params.tenantId,
      limit: 10_000,
      offset: 0,
    });

    let data: string;
    if (params.format === "ndjson") {
      data = events.map((e) => JSON.stringify(e)).join("\n");
    } else {
      data = JSON.stringify(events, null, 2);
    }

    return { data };
  });

  // ── GDPR ───────────────────────────────────────────────────────────────────

  server.registerMethod("enterprise.gdpr.export", async (params: { userId: string }) => {
    const { store } = requireIAM();
    const audit = getAuditStorage();
    const data = await gdprExportUser(params.userId, store, audit ?? undefined);
    return { data };
  });

  server.registerMethod("enterprise.gdpr.erase", async (params: { userId: string }) => {
    const { store, tokens } = requireIAM();
    const audit = getAuditStorage();
    const result = await gdprEraseUser(params.userId, store, tokens ?? undefined, audit ?? undefined);
    return result;
  });

  // ── MFA ────────────────────────────────────────────────────────────────────

  server.registerMethod("enterprise.mfa.enroll", async (params: { userId: string }) => {
    const { store } = requireIAM();
    const user = await store.getUser(params.userId);
    if (!user) {throw Object.assign(new Error("User not found"), { code: "NOT_FOUND" });}
    return MfaService.generateEnrollment(user.id, user.email);
  });

  server.registerMethod("enterprise.mfa.verify", async (params: {
    userId: string;
    code: string;
  }) => {
    const { store } = requireIAM();
    const user = await store.getUser(params.userId);
    if (!user) {throw Object.assign(new Error("User not found"), { code: "NOT_FOUND" });}
    if (!user.totpSecret) {return { ok: false };}
    const ok = MfaService.verify(user.totpSecret, params.code);
    return { ok };
  });

  server.registerMethod("enterprise.mfa.confirm-enroll", async (params: {
    userId: string;
    secret: string;
    code: string;
  }) => {
    const { store } = requireIAM();
    const user = await store.getUser(params.userId);
    if (!user) {throw Object.assign(new Error("User not found"), { code: "NOT_FOUND" });}
    const ok = MfaService.verify(params.secret, params.code);
    if (!ok) {throw Object.assign(new Error("Invalid TOTP code"), { code: "INVALID_CODE" });}
    await store.upsertUser({ ...user, totpSecret: params.secret, mfaEnabled: true });
    return { ok: true as const };
  });

  server.registerMethod("enterprise.mfa.disable", async (params: { userId: string }) => {
    const { store } = requireIAM();
    const user = await store.getUser(params.userId);
    if (!user) {throw Object.assign(new Error("User not found"), { code: "NOT_FOUND" });}
    await store.upsertUser({ ...user, totpSecret: undefined, mfaEnabled: false });
    return { ok: true as const };
  });

  // ── IP allowlist ───────────────────────────────────────────────────────────

  server.registerMethod("enterprise.ip-allowlist.check", async (params: {
    userId: string;
    ipAddress: string;
  }) => {
    const { store } = requireIAM();
    const user = await store.getUser(params.userId);
    if (!user) {return { allowed: false, reason: "User not found" };}
    const allowed = IpAllowlist.isAllowed(params.ipAddress, user.allowedCidrs);
    return { allowed, reason: allowed ? "ok" : "IP not in allowlist" };
  });
}

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
