/**
 * Audit logger — write structured, tamper-evident events to the configured backend.
 *
 * Usage:
 *   import { auditLog } from "./logger.js";
 *   await auditLog({ action: AUDIT_ACTIONS.AGENT_RUN_START, ... });
 */

import { buildAuditEvent, type AuditEventInput, type AuditEvent } from "./schema.js";
import type { AuditStorage } from "./storage/sqlite.js";

let storage: AuditStorage | null = null;
let lastHash: string | undefined;
let enabled = false;

export function setAuditStorage(s: AuditStorage): void {
  storage = s;
  enabled = true;
}

export function setAuditEnabled(value: boolean): void {
  enabled = value;
}

/**
 * Write a structured audit event.
 * Non-blocking — errors are swallowed so audit failures never break the main flow.
 */
export async function auditLog(input: AuditEventInput): Promise<AuditEvent | null> {
  if (!enabled || !storage) {return null;}

  try {
    const event = buildAuditEvent(input, lastHash);
    lastHash = event.hash;
    await storage.append(event);
    return event;
  } catch (err) {
    // Audit logging must never crash the application
    process.stderr.write(`[audit] Failed to write audit event: ${err}\n`);
    return null;
  }
}

/**
 * Synchronous wrapper for contexts that can't await.
 * Queues the event and writes asynchronously.
 */
export function auditLogSync(input: AuditEventInput): void {
  if (!enabled || !storage) {return;}
  auditLog(input).catch(() => {});
}

export function getAuditStorage(): AuditStorage | null {
  return storage;
}
