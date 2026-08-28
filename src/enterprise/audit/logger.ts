/**
 * Audit logger — write structured, tamper-evident events to the configured backend.
 *
 * Usage:
 *   import { auditLog } from "./logger.js";
 *   await auditLog({ action: AUDIT_ACTIONS.AGENT_RUN_START, ... });
 */

import { buildAuditEvent, type AuditEventInput, type AuditEvent } from "./schema.js";
import type { AuditSink } from "./sinks/syslog.js";
import type { AuditStorage } from "./storage/sqlite.js";

let storage: AuditStorage | null = null;
let lastHash: string | undefined;
let lastSeq: number | undefined;
let enabled = false;
let sinks: AuditSink[] = [];

export function setAuditStorage(s: AuditStorage): void {
  storage = s;
  enabled = true;
}

export function setAuditEnabled(value: boolean): void {
  enabled = value;
}

/**
 * Seed the in-memory chain head from persisted storage so the hash chain
 * continues across process restarts instead of forking. Without this, the first
 * event written after a restart carries previousHash=undefined while prior events
 * exist in the store, which verifyChain (correctly) reads as a broken link — a
 * benign restart becomes indistinguishable from tampering/truncation.
 */
export function seedAuditChain(head: { hash: string; seq: number } | undefined): void {
  lastHash = head?.hash;
  lastSeq = head?.seq;
}

/** Register the external audit sinks that each event fans out to after append. */
export function setAuditSinks(s: AuditSink[]): void {
  sinks = s;
}

export function getAuditSinks(): AuditSink[] {
  return sinks;
}

/**
 * Write a structured audit event.
 * Non-blocking — errors are swallowed so audit failures never break the main flow.
 */
export async function auditLog(input: AuditEventInput): Promise<AuditEvent | null> {
  if (!enabled || !storage) return null;

  let event: AuditEvent;
  try {
    event = buildAuditEvent(input, lastHash, lastSeq);
    // Advance the chain head ONLY after the durable write succeeds. Advancing
    // before the append (the previous behavior) meant a dropped event left
    // lastHash pointing at a hash that exists nowhere in storage, permanently
    // breaking verifyChain at that boundary while silently losing the record.
    await storage.append(event);
    lastHash = event.hash;
    lastSeq = event.seq;
  } catch (err) {
    // Audit logging must never crash the application, but the head must not be
    // poisoned by a failed write — lastHash/lastSeq are left untouched above so
    // the next event chains from the last DURABLE event.
    process.stderr.write(`[audit] Failed to write audit event: ${err}\n`);
    return null;
  }

  // Fan out to external SIEM/compliance sinks. Each send is isolated so one
  // sink's failure neither blocks the others nor crashes the app.
  if (sinks.length > 0) {
    await Promise.all(
      sinks.map(async (sink) => {
        try {
          await sink.send(event);
        } catch (err) {
          process.stderr.write(`[audit] Sink send failed: ${err}\n`);
        }
      }),
    );
  }

  return event;
}

/**
 * Synchronous wrapper for contexts that can't await.
 * Queues the event and writes asynchronously.
 */
export function auditLogSync(input: AuditEventInput): void {
  if (!enabled || !storage) return;
  auditLog(input).catch(() => {});
}

export function getAuditStorage(): AuditStorage | null {
  return storage;
}
