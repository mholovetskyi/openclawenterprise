/**
 * GDPR compliance helpers — user data export and right-to-erasure.
 *
 * Art. 17 "Right to erasure" and Art. 20 "Right to data portability".
 *
 * Export: collects all personal data held about a user.
 * Erase:  anonymizes all records rather than hard-deleting audit events
 *         (hard deletion would break the hash chain). Personal identifiers
 *         are replaced with a pseudonym derived from the user ID.
 */

import { createHash } from "node:crypto";
import type { AuditStorage } from "../audit/storage/sqlite.js";
import type { TokenStore } from "../auth/token-store.js";
import type { User } from "./rbac/model.js";
import type { RBACStore } from "./rbac/store.js";

// ── Export ─────────────────────────────────────────────────────────────────────

export type GdprExportResult = {
  exportedAt: string;
  userId: string;
  profile: unknown;
  auditEvents: unknown[];
  activeSessions: unknown[];
};

/**
 * Project a stored User onto a redacting ALLOWLIST for GDPR export.
 *
 * Allowlist (not denylist) on purpose: only the fields named here are ever
 * exported, so any future secret-bearing field added to the User model is
 * excluded by default rather than silently leaking. In particular `totpSecret`
 * — the plaintext base32 TOTP/MFA seed — is deliberately omitted: an export is
 * routinely handed to the data subject / support staff and stored in ticketing
 * systems, and the seed would let anyone holding it mint valid MFA codes
 * indefinitely, defeating that user's MFA.
 */
function redactUserForExport(u: User): Record<string, unknown> {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    roles: u.roles ?? [],
    groups: u.groups ?? [],
    tenantId: u.tenantId,
    externalId: u.externalId,
    channelIds: u.channelIds,
    active: u.active,
    enabled: u.enabled,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    lastLoginAt: u.lastLoginAt,
    lastSeenAt: u.lastSeenAt,
    mfaEnabled: u.mfaEnabled ?? false,
    allowedCidrs: u.allowedCidrs,
    // NOTE: `totpSecret` (and any future secret/credential field) is intentionally
    // NOT included — see the allowlist rationale above.
  };
}

export async function gdprExportUser(
  userId: string,
  store: RBACStore,
  audit?: AuditStorage,
  tokens?: TokenStore,
): Promise<GdprExportResult> {
  const user = await store.getUser(userId);

  let auditEvents: unknown[] = [];
  if (audit) {
    const result = await audit.query({ actorId: userId, limit: 10_000, offset: 0 });
    auditEvents = result.events;
  }

  const activeSessions = tokens ? tokens.listActiveSessions(userId) : [];

  return {
    exportedAt: new Date().toISOString(),
    userId,
    // Redact through an allowlist so the plaintext TOTP seed (and any future
    // secret field) never reaches the export payload.
    profile: user ? redactUserForExport(user) : null,
    auditEvents,
    activeSessions,
  };
}

// ── Erase ──────────────────────────────────────────────────────────────────────

export type GdprEraseResult = {
  ok: true;
  auditEventsAnonymized: number;
  sessionsRevoked: number;
  /** Number of RBAC groups from which the user's membership was removed. */
  groupsUpdated: number;
};

/**
 * Pseudonymize a user ID for audit log anonymization.
 * The pseudonym is deterministic per userId but not reversible.
 */
function pseudonymize(userId: string): string {
  const hash = createHash("sha256").update(`gdpr-erase:${userId}`).digest("hex").slice(0, 16);
  return `[erased-${hash}]`;
}

export async function gdprEraseUser(
  userId: string,
  store: RBACStore,
  tokens?: TokenStore,
  audit?: AuditStorage,
): Promise<GdprEraseResult> {
  let sessionsRevoked = 0;
  let auditEventsAnonymized = 0;
  let groupsUpdated = 0;

  // 1. Revoke all active sessions
  if (tokens) {
    sessionsRevoked = tokens.revokeAllForSubject(userId);
  }

  // 2. Anonymize audit events — replace actor.id, actor.email, actor.name
  //    with the pseudonym. The hash chain remains intact.
  //    NOTE: completeness of audit-side purge (actor.ip and events where the
  //    erased user is the *resource*) depends on the audit backend's
  //    anonymizeActor implementation, which lives in the audit module. See the
  //    integrationHook returned for this finding. In-memory / no-capability
  //    backends anonymize nothing.
  if (audit && "anonymizeActor" in audit && typeof audit.anonymizeActor === "function") {
    // If the audit storage supports direct anonymization (e.g. SQLite backend)
    // SAFETY: the enclosing `if` verified "anonymizeActor" in audit and that it is a function, so the storage implements the AuditStorageWithAnonymize extension.
    auditEventsAnonymized = await (audit as AuditStorageWithAnonymize).anonymizeActor(
      userId,
      pseudonymize(userId),
    );
  }

  // 3. Purge the user's PII from every RBAC store this module owns.
  //    Remove the user id from all Group.members so no dangling membership
  //    reference survives the erasure (deleteUser only removes the user row +
  //    channel index).
  const groups = await store.listGroups();
  for (const g of groups) {
    if (g.members.includes(userId)) {
      await store.upsertGroup({
        ...g,
        members: g.members.filter((m) => m !== userId),
        updatedAt: new Date().toISOString(),
      });
      groupsUpdated++;
    }
  }

  // 4. Delete the user profile from the RBAC store
  await store.deleteUser(userId);

  return { ok: true, auditEventsAnonymized, sessionsRevoked, groupsUpdated };
}

// ── Extended audit interface for anonymization ────────────────────────────────

type AuditStorageWithAnonymize = AuditStorage & {
  anonymizeActor(actorId: string, pseudonym: string): Promise<number>;
};
