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
  /**
   * Monotonically increasing per-chain sequence number (genesis = 0). Included
   * in the hash pre-image so gaps, reordering, and interior deletion are
   * detectable independent of array position.
   */
  seq?: number;
  /**
   * Commitment to the erasable actor PII (id/name/email/ip/channel/
   * channelUserId/sessionId). Included in the hash pre-image while the raw PII
   * fields themselves are excluded, so a lawful GDPR erasure that strips those
   * fields does NOT alter the hash (the chain stays verifiable) yet the original
   * identity remains cryptographically committed. See {@link computeActorCommitment}.
   */
  actorCommitment?: string;
  previousHash?: string; // SHA-256 of previous event in chain
  hash: string; // SHA-256 of this event (excluding hash field itself)
  /**
   * Set to true by a GDPR erasure. Excluded from the hash pre-image; signals that
   * the raw actor PII has been stripped and can no longer be re-derived from the
   * event for the live-binding check.
   */
  erased?: boolean;
};

export type AuditEventInput = Omit<
  AuditEvent,
  "id" | "timestamp" | "version" | "hash" | "previousHash" | "seq" | "actorCommitment" | "erased"
>;

/** Actor fields that are erasable PII — excluded from the hash pre-image. */
export const ERASABLE_ACTOR_FIELDS = [
  "id",
  "name",
  "email",
  "ip",
  "channel",
  "channelUserId",
  "sessionId",
] as const satisfies ReadonlyArray<keyof AuditActor>;

const ERASABLE_ACTOR_FIELD_SET: ReadonlySet<string> = new Set(ERASABLE_ACTOR_FIELDS);

/** Anchor for detecting prefix/suffix truncation that a pure hash chain cannot. */
export type ChainAnchor = {
  /** Expected previousHash of the first (genesis) event. Defaults to undefined. */
  genesisPreviousHash?: string;
  /** Expected seq of the first event. Defaults to 0. */
  expectedFirstSeq?: number;
  /** Expected total number of events (detects suffix/prefix truncation). */
  expectedCount?: number;
  /** Expected hash of the last event (detects suffix truncation). */
  expectedHead?: string;
};

/**
 * Compute a stable commitment to the erasable actor PII. This lets the hash
 * pre-image bind the actor's identity without embedding the raw PII, so erasure
 * can strip the PII fields while leaving the hash (and thus the chain) intact.
 */
export function computeActorCommitment(actor: AuditActor): string {
  const pii: Record<string, unknown> = {};
  for (const field of ERASABLE_ACTOR_FIELDS) {
    const value = actor[field];
    if (value !== undefined) pii[field] = value;
  }
  return createHash("sha256").update(canonicalJson(pii)).digest("hex");
}

/**
 * Build a new AuditEvent from input, computing the tamper-evident hash.
 * @param previousHash hash of the previous event in the chain (undefined = genesis)
 * @param previousSeq seq of the previous event (undefined = genesis, this event is seq 0)
 */
export function buildAuditEvent(
  input: AuditEventInput,
  previousHash?: string,
  previousSeq?: number,
): AuditEvent {
  const id = generateULID();
  const timestamp = new Date().toISOString();

  const event: AuditEvent = {
    id,
    timestamp,
    version: 1,
    ...input,
    seq: previousSeq === undefined ? 0 : previousSeq + 1,
    actorCommitment: computeActorCommitment(input.actor),
    previousHash,
    hash: "", // computed below
  };

  event.hash = computeEventHash(event);
  return event;
}

/**
 * Verify the hash of an event matches its content. Stable across a lawful
 * erasure (which strips raw PII but preserves the committed hash).
 */
export function verifyEventHash(event: AuditEvent): boolean {
  const expected = computeEventHash(event);
  return expected === event.hash;
}

/**
 * Verify that the raw actor PII still matches the committed fingerprint. Only
 * meaningful for events that have NOT been erased (erased events no longer carry
 * the raw PII, so the binding cannot be re-derived). Returns true when the event
 * has no commitment (legacy) or has been erased.
 */
export function verifyActorCommitment(event: AuditEvent): boolean {
  if (event.actorCommitment === undefined || event.erased) return true;
  return computeActorCommitment(event.actor) === event.actorCommitment;
}

/**
 * Verify an entire chain of events for tamper evidence.
 *
 * Without an anchor this validates interior links, per-event hashes, sequence
 * continuity, and (for a full-log verification) that the first event is the true
 * genesis — which catches interior tampering AND prefix truncation. Detecting
 * suffix truncation requires an out-of-band anchor ({@link ChainAnchor} with
 * expectedCount / expectedHead) because a pure hash chain cannot otherwise tell
 * that the newest events were removed.
 */
export function verifyChain(
  events: AuditEvent[],
  anchor?: ChainAnchor,
): { valid: boolean; firstBrokenIndex?: number } {
  const genesisPrev = anchor?.genesisPreviousHash;
  const firstSeq = anchor?.expectedFirstSeq ?? 0;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    // A missing entry (sparse array) is treated as a broken chain, not skipped.
    if (!event || !verifyEventHash(event)) {
      return { valid: false, firstBrokenIndex: i };
    }
    if (i === 0) {
      // Anchor the genesis: the first event of a full log must link to the
      // genesis sentinel (undefined by default). Prefix truncation makes the
      // new first event point at a now-deleted predecessor, which trips here.
      if (event.previousHash !== genesisPrev) {
        return { valid: false, firstBrokenIndex: 0 };
      }
      if (anchor?.expectedFirstSeq !== undefined && event.seq !== firstSeq) {
        return { valid: false, firstBrokenIndex: 0 };
      }
    } else {
      const prev = events[i - 1]!;
      if (event.previousHash !== prev.hash) {
        return { valid: false, firstBrokenIndex: i };
      }
      // Sequence continuity — detects gaps/reordering when seq is present.
      if (
        typeof event.seq === "number" &&
        typeof prev.seq === "number" &&
        event.seq !== prev.seq + 1
      ) {
        return { valid: false, firstBrokenIndex: i };
      }
    }
  }

  if (anchor) {
    if (anchor.expectedCount !== undefined && events.length !== anchor.expectedCount) {
      // Missing prefix or suffix relative to the recorded count.
      return { valid: false, firstBrokenIndex: Math.max(0, events.length - 1) };
    }
    if (anchor.expectedHead !== undefined) {
      const last = events[events.length - 1];
      if (!last || last.hash !== anchor.expectedHead) {
        return { valid: false, firstBrokenIndex: Math.max(0, events.length - 1) };
      }
    }
  }

  return { valid: true };
}

/**
 * Produce a GDPR-erased copy of an event: the raw actor PII is stripped (id
 * replaced with a pseudonym; name/email/ip/channel/channelUserId/sessionId
 * removed) and the event is marked erased. Because the erasable PII fields are
 * excluded from the hash pre-image, the hash — and therefore the chain — remains
 * valid. The original identity stays committed via actorCommitment.
 */
export function anonymizeEventActor(event: AuditEvent, pseudonym: string): AuditEvent {
  const actor: AuditActor = { ...event.actor, id: pseudonym };
  delete actor.name;
  delete actor.email;
  delete actor.ip;
  delete actor.channel;
  delete actor.channelUserId;
  delete actor.sessionId;
  return { ...event, actor, erased: true };
}

function computeEventHash(event: AuditEvent): string {
  // Exclude the hash field and the (post-hoc) erased marker; exclude the raw
  // erasable actor PII (it is committed via actorCommitment instead), so a lawful
  // erasure never alters the hash. Everything else — including metadata, resource,
  // seq, and the actor commitment — is covered by a deep, key-sorted canonical form.
  const { hash: _hash, erased: _erased, actor, ...rest } = event;
  const strippedActor: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(actor)) {
    if (!ERASABLE_ACTOR_FIELD_SET.has(k)) strippedActor[k] = v;
  }
  const preimage = { ...rest, actor: strippedActor };
  return createHash("sha256").update(canonicalJson(preimage)).digest("hex");
}

/** Deterministic, deep, key-sorted JSON serialization for hashing. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    if (obj[key] !== undefined) out[key] = canonicalize(obj[key]);
  }
  return out;
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
