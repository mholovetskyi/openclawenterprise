/**
 * Audit event schema — tamper-evident, structured, SOC 2 / HIPAA / GDPR ready.
 */

import { createHash } from "node:crypto";

export type AuditEventCategory =
  | "auth"
  | "agent"
  | "skill"
  | "config"
  | "admin"
  | "data"
  | "system"
  | "security";

export type AuditEventOutcome = "success" | "failure" | "denied";

export type AuditActor = {
  type: "user" | "agent" | "system" | "api-key" | "anonymous";
  id: string;
  name?: string;
  email?: string;
  ip?: string;
  channel?: string;
  channelUserId?: string;
  tenantId?: string;
  sessionId?: string;
};

export type AuditResource = {
  type: string; // e.g. "agent", "skill", "session", "user", "config"
  id: string;
  name?: string;
};

export type AuditEvent = {
  /** ULID-style sortable ID */
  id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Schema version */
  version: 1;

  // WHO
  actor: AuditActor;

  // WHAT
  action: string; // e.g. "agent.run", "skill.install", "config.update"
  category: AuditEventCategory;

  // WHERE
  resource?: AuditResource;

  // RESULT
  outcome: AuditEventOutcome;
  durationMs?: number;
  errorMessage?: string;

  // DETAILS
  metadata?: Record<string, unknown>;

  // TAMPER EVIDENCE
  previousHash?: string; // SHA-256 of previous event in chain
  hash: string; // SHA-256 of this event (excluding hash field itself)
};

export type AuditEventInput = Omit<
  AuditEvent,
  "id" | "timestamp" | "version" | "hash" | "previousHash"
>;

/**
 * Build a new AuditEvent from input, computing the tamper-evident hash.
 */
export function buildAuditEvent(input: AuditEventInput, previousHash?: string): AuditEvent {
  const id = generateULID();
  const timestamp = new Date().toISOString();

  const event: AuditEvent = {
    id,
    timestamp,
    version: 1,
    ...input,
    previousHash,
    hash: "", // computed below
  };

  event.hash = computeEventHash(event);
  return event;
}

/**
 * Verify the hash of an event matches its content.
 */
export function verifyEventHash(event: AuditEvent): boolean {
  const expected = computeEventHash(event);
  return expected === event.hash;
}

/**
 * Verify an entire chain of events for tamper evidence.
 */
export function verifyChain(events: AuditEvent[]): { valid: boolean; firstBrokenIndex?: number } {
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    // A missing entry (sparse array) is treated as a broken chain, not skipped.
    if (!event || !verifyEventHash(event)) {
      return { valid: false, firstBrokenIndex: i };
    }
    const prev = i > 0 ? events[i - 1] : undefined;
    if (prev && event.previousHash !== prev.hash) {
      return { valid: false, firstBrokenIndex: i };
    }
  }
  return { valid: true };
}

function computeEventHash(event: AuditEvent): string {
  // Exclude the hash field itself from the computation
  const { hash: _hash, ...rest } = event;
  const canonical = JSON.stringify(rest, Object.keys(rest).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

// ── ULID-style ID generation ───────────────────────────────────────────────────
// Format: timestamp (10 chars base32) + random (16 chars base32)

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeBase32(n: number, length: number): string {
  let result = "";
  for (let i = length - 1; i >= 0; i--) {
    result = CROCKFORD[n % 32] + result;
    n = Math.floor(n / 32);
  }
  return result;
}

function generateULID(): string {
  const ms = Date.now();
  const rand = Math.floor(Math.random() * 0xffffffffffff);
  return encodeBase32(ms, 10) + encodeBase32(rand, 16);
}

// ── Well-known audit actions ───────────────────────────────────────────────────

export const AUDIT_ACTIONS = {
  // Auth
  AUTH_LOGIN_SUCCESS: "auth.login.success",
  AUTH_LOGIN_FAILURE: "auth.login.failure",
  AUTH_LOGOUT: "auth.logout",
  AUTH_TOKEN_ISSUED: "auth.token.issued",
  AUTH_TOKEN_REVOKED: "auth.token.revoked",
  AUTH_PAIRING_APPROVED: "auth.pairing.approved",
  AUTH_PAIRING_REJECTED: "auth.pairing.rejected",
  AUTH_RATE_LIMITED: "auth.rate_limited",

  // Agents
  AGENT_RUN_START: "agent.run.start",
  AGENT_RUN_END: "agent.run.end",
  AGENT_CREATED: "agent.created",
  AGENT_UPDATED: "agent.updated",
  AGENT_DELETED: "agent.deleted",

  // Skills
  SKILL_INSTALLED: "skill.installed",
  SKILL_UPDATED: "skill.updated",
  SKILL_REMOVED: "skill.removed",
  SKILL_SCAN_FINDING: "skill.scan.finding",

  // Config
  CONFIG_UPDATED: "config.updated",
  CONFIG_READ: "config.read",

  // Sessions
  SESSION_CREATED: "session.created",
  SESSION_DELETED: "session.deleted",
  SESSION_COMPACTED: "session.compacted",

  // Users (enterprise)
  USER_CREATED: "admin.user.created",
  USER_UPDATED: "admin.user.updated",
  USER_DELETED: "admin.user.deleted",
  ROLE_ASSIGNED: "admin.role.assigned",
  ROLE_REVOKED: "admin.role.revoked",

  // Tools
  TOOL_BASH_EXEC: "tool.bash.exec",
  TOOL_BROWSER_ACTION: "tool.browser.action",

  // System
  GATEWAY_START: "system.gateway.start",
  GATEWAY_STOP: "system.gateway.stop",
  SECURITY_AUDIT_RUN: "security.audit.run",
} as const;
