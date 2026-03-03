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
import type { RBACStore } from "./rbac/store.js";

// ── Export ─────────────────────────────────────────────────────────────────────

export type GdprExportResult = {
  exportedAt: string;
  userId: string;
  profile: unknown;
  auditEvents: unknown[];
  activeSessions: unknown[];
};

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
    profile: user ?? null,
    auditEvents,
    activeSessions,
  };
}

// ── Erase ──────────────────────────────────────────────────────────────────────

export type GdprEraseResult = {
  ok: true;
  auditEventsAnonymized: number;
  sessionsRevoked: number;
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

  // 1. Revoke all active sessions
  if (tokens) {
    sessionsRevoked = tokens.revokeAllForSubject(userId);
  }

  // 2. Anonymize audit events — replace actor.id, actor.email, actor.name
  //    with the pseudonym. The hash chain remains intact.
  if (audit && "anonymizeActor" in audit && typeof audit.anonymizeActor === "function") {
    // If the audit storage supports direct anonymization (e.g. SQLite backend)
    auditEventsAnonymized = await (audit as AuditStorageWithAnonymize).anonymizeActor(
      userId,
      pseudonymize(userId),
    );
  }

  // 3. Delete the user profile from the RBAC store
  await store.deleteUser(userId);

  return { ok: true, auditEventsAnonymized, sessionsRevoked };
}

// ── Extended audit interface for anonymization ────────────────────────────────

type AuditStorageWithAnonymize = AuditStorage & {
  anonymizeActor(actorId: string, pseudonym: string): Promise<number>;
};
