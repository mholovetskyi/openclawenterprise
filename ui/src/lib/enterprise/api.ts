/**
 * Enterprise admin panel gateway API.
 *
 * Wraps the enterprise.* RPC methods with typed request/response shapes.
 * Consumed by the Enterprise settings page (ui/src/pages/enterprise/).
 */
import type { GatewayBrowserClient } from "../../api/gateway.ts";

// ── Wire types ────────────────────────────────────────────────────────────────

export type EnterpriseRbacUser = {
  id: string;
  name?: string;
  email?: string;
  displayName?: string;
  roles: string[];
  groups: string[];
  tenantId?: string;
  active: boolean;
  createdAt?: string;
  lastSeenAt?: string;
  mfaEnabled?: boolean;
  allowedCidrs?: string[];
};

export type EnterpriseRbacRole = {
  id: string;
  displayName: string;
  permissions: string[];
  builtIn?: boolean;
};

export type EnterpriseAuditEventSummary = {
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

export type EnterpriseActiveSession = {
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
): Promise<{ users: EnterpriseRbacUser[]; total: number }> {
  return await client.request<{ users: EnterpriseRbacUser[]; total: number }>("enterprise.users.list", opts ?? {});
}

export async function upsertEnterpriseUser(
  client: GatewayBrowserClient,
  user: Omit<EnterpriseRbacUser, "createdAt" | "lastSeenAt" | "mfaEnabled">,
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
): Promise<{ roles: EnterpriseRbacRole[] }> {
  return await client.request<{ roles: EnterpriseRbacRole[] }>("enterprise.roles.list", {});
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export async function listEnterpriseSessions(
  client: GatewayBrowserClient,
  subjectId: string,
): Promise<{ sessions: EnterpriseActiveSession[] }> {
  return await client.request<{ sessions: EnterpriseActiveSession[] }>("enterprise.sessions.list", { subjectId });
}

export async function revokeEnterpriseSession(
  client: GatewayBrowserClient,
  params: { jti?: string; subjectId?: string },
): Promise<{ revoked: number }> {
  return await client.request<{ revoked: number }>("enterprise.sessions.revoke", params);
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
): Promise<{ events: EnterpriseAuditEventSummary[]; total: number }> {
  return await client.request<{ events: EnterpriseAuditEventSummary[]; total: number }>(
    "enterprise.audit.query", opts ?? {});
}

// ── MFA ───────────────────────────────────────────────────────────────────────

export async function enrollMfa(
  client: GatewayBrowserClient,
  userId: string,
): Promise<{ secret: string; otpauthUri: string }> {
  return await client.request<{ secret: string; otpauthUri: string }>("enterprise.mfa.enroll", { userId });
}

export async function confirmMfaEnrollment(
  client: GatewayBrowserClient,
  userId: string,
  secret: string,
  code: string,
): Promise<{ ok: boolean }> {
  return await client.request<{ ok: boolean }>("enterprise.mfa.confirm-enroll", { userId, secret, code });
}

export async function disableMfa(client: GatewayBrowserClient, userId: string): Promise<void> {
  await client.request("enterprise.mfa.disable", { userId });
}

// ── GDPR ──────────────────────────────────────────────────────────────────────

export async function gdprExport(
  client: GatewayBrowserClient,
  userId: string,
): Promise<{ data: unknown }> {
  return await client.request<{ data: unknown }>("enterprise.gdpr.export", { userId });
}

export async function gdprErase(
  client: GatewayBrowserClient,
  userId: string,
): Promise<{ ok: true; auditEventsAnonymized: number; sessionsRevoked: number }> {
  return await client.request<{
    ok: true;
    auditEventsAnonymized: number;
    sessionsRevoked: number;
  }>("enterprise.gdpr.erase", { userId });
}
