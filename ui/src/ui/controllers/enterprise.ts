/**
 * Enterprise admin panel gateway controller.
 *
 * Wraps enterprise.* RPC methods with typed request/response shapes
 * and provides the loadEnterprise* helpers called from app-render.ts.
 */

import type { GatewayBrowserClient } from "../gateway.ts";

// ── Wire types ────────────────────────────────────────────────────────────────

export type RbacUser = {
  id: string;
  name?: string;
  email?: string;
  roles: string[];
  groups: string[];
  tenantId?: string;
  active: boolean;
  createdAt?: string;
  lastSeenAt?: string;
  mfaEnabled?: boolean;
  allowedCidrs?: string[];
};

export type RbacRole = {
  id: string;
  displayName: string;
  permissions: string[];
  builtIn?: boolean;
};

export type AuditEventSummary = {
  id: string;
  timestamp: string;
  actorId: string;
  actorEmail?: string;
  action: string;
  category: string;
  outcome: string;
  resourceId?: string;
  resourceType?: string;
  tenantId?: string;
  errorMessage?: string;
  durationMs?: number;
};

export type ActiveSession = {
  jti: string;
  subjectId: string;
  issuedAt: number;
  expiresAt: number;
  userAgent?: string;
  ipAddress?: string;
};

// ── Users ─────────────────────────────────────────────────────────────────────

export async function loadEnterpriseUsers(
  client: GatewayBrowserClient,
  opts?: { tenantId?: string; limit?: number; offset?: number },
): Promise<{ users: RbacUser[]; total: number }> {
  return client.request("enterprise.users.list", opts ?? {});
}

export async function upsertEnterpriseUser(
  client: GatewayBrowserClient,
  user: Omit<RbacUser, "createdAt" | "lastSeenAt" | "mfaEnabled">,
): Promise<void> {
  await client.request("enterprise.users.upsert", user);
}

export async function deleteEnterpriseUser(
  client: GatewayBrowserClient,
  userId: string,
): Promise<void> {
  await client.request("enterprise.users.delete", { userId });
}

// ── Roles ─────────────────────────────────────────────────────────────────────

export async function loadEnterpriseRoles(
  client: GatewayBrowserClient,
): Promise<{ roles: RbacRole[] }> {
  return client.request("enterprise.roles.list", {});
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export async function listEnterpriseSessions(
  client: GatewayBrowserClient,
  subjectId: string,
): Promise<{ sessions: ActiveSession[] }> {
  return client.request("enterprise.sessions.list", { subjectId });
}

export async function revokeEnterpriseSession(
  client: GatewayBrowserClient,
  params: { jti?: string; subjectId?: string },
): Promise<{ revoked: number }> {
  return client.request("enterprise.sessions.revoke", params);
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export async function loadEnterpriseAudit(
  client: GatewayBrowserClient,
  opts?: {
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
  },
): Promise<{ events: AuditEventSummary[]; total: number }> {
  return client.request("enterprise.audit.query", opts ?? {});
}

// ── MFA ───────────────────────────────────────────────────────────────────────

export async function enrollMfa(
  client: GatewayBrowserClient,
  userId: string,
): Promise<{ secret: string; otpauthUri: string }> {
  return client.request("enterprise.mfa.enroll", { userId });
}

export async function confirmMfaEnrollment(
  client: GatewayBrowserClient,
  userId: string,
  secret: string,
  code: string,
): Promise<{ ok: boolean }> {
  return client.request("enterprise.mfa.confirm-enroll", { userId, secret, code });
}

export async function disableMfa(
  client: GatewayBrowserClient,
  userId: string,
): Promise<void> {
  await client.request("enterprise.mfa.disable", { userId });
}

// ── GDPR ──────────────────────────────────────────────────────────────────────

export async function gdprExport(
  client: GatewayBrowserClient,
  userId: string,
): Promise<{ data: unknown }> {
  return client.request("enterprise.gdpr.export", { userId });
}

export async function gdprErase(
  client: GatewayBrowserClient,
  userId: string,
): Promise<{ ok: true; auditEventsAnonymized: number; sessionsRevoked: number }> {
  return client.request("enterprise.gdpr.erase", { userId });
}
