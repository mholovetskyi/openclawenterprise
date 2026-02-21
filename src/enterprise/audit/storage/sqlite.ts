/**
 * SQLite audit log storage backend.
 * Uses WAL mode for concurrent reads, with hash chain integrity.
 */

import type { AuditEvent } from "../schema.js";

export type AuditQueryOptions = {
  limit?: number;
  offset?: number;
  actorId?: string;
  category?: string;
  action?: string;
  outcome?: string;
  tenantId?: string;
  from?: string;  // ISO 8601
  until?: string; // ISO 8601
  search?: string;
};

export interface AuditStorage {
  append(event: AuditEvent): Promise<void>;
  query(opts: AuditQueryOptions): Promise<{ events: AuditEvent[]; total: number }>;
  getLastHash(): Promise<string | undefined>;
  count(): Promise<number>;
  shutdown(): Promise<void>;
}

/**
 * SQLite-backed audit storage.
 * Dynamically imports `better-sqlite3` to avoid hard dependency.
 */
export async function createSQLiteAuditStorage(dbPath: string): Promise<AuditStorage> {
  let Database: typeof import("better-sqlite3");
  try {
    const mod = await import("better-sqlite3");
    Database = mod.default ?? mod;
  } catch {
    throw new Error(
      "SQLite audit backend requires better-sqlite3. Run: npm install better-sqlite3",
    );
  }

  const db = new Database(dbPath);

  // Configure for durability + performance
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id          TEXT PRIMARY KEY,
      timestamp   TEXT NOT NULL,
      actor_id    TEXT NOT NULL,
      actor_type  TEXT NOT NULL,
      actor_email TEXT,
      action      TEXT NOT NULL,
      category    TEXT NOT NULL,
      resource_id TEXT,
      resource_type TEXT,
      outcome     TEXT NOT NULL,
      duration_ms INTEGER,
      tenant_id   TEXT,
      error_msg   TEXT,
      previous_hash TEXT,
      hash        TEXT NOT NULL,
      metadata    TEXT,  -- JSON blob
      raw         TEXT NOT NULL  -- full event JSON for integrity verification
    );

    CREATE INDEX IF NOT EXISTS idx_audit_timestamp  ON audit_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_actor_id   ON audit_events(actor_id);
    CREATE INDEX IF NOT EXISTS idx_audit_action     ON audit_events(action);
    CREATE INDEX IF NOT EXISTS idx_audit_category   ON audit_events(category);
    CREATE INDEX IF NOT EXISTS idx_audit_outcome    ON audit_events(outcome);
    CREATE INDEX IF NOT EXISTS idx_audit_tenant     ON audit_events(tenant_id);
  `);

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO audit_events
      (id, timestamp, actor_id, actor_type, actor_email, action, category,
       resource_id, resource_type, outcome, duration_ms, tenant_id, error_msg,
       previous_hash, hash, metadata, raw)
    VALUES
      (@id, @timestamp, @actor_id, @actor_type, @actor_email, @action, @category,
       @resource_id, @resource_type, @outcome, @duration_ms, @tenant_id, @error_msg,
       @previous_hash, @hash, @metadata, @raw)
  `);

  const lastHashStmt = db.prepare(
    "SELECT hash FROM audit_events ORDER BY timestamp DESC LIMIT 1",
  );

  return {
    async append(event: AuditEvent): Promise<void> {
      insertStmt.run({
        id: event.id,
        timestamp: event.timestamp,
        actor_id: event.actor.id,
        actor_type: event.actor.type,
        actor_email: event.actor.email ?? null,
        action: event.action,
        category: event.category,
        resource_id: event.resource?.id ?? null,
        resource_type: event.resource?.type ?? null,
        outcome: event.outcome,
        duration_ms: event.durationMs ?? null,
        tenant_id: event.actor.tenantId ?? null,
        error_msg: event.errorMessage ?? null,
        previous_hash: event.previousHash ?? null,
        hash: event.hash,
        metadata: event.metadata ? JSON.stringify(event.metadata) : null,
        raw: JSON.stringify(event),
      });
    },

    async query(opts: AuditQueryOptions): Promise<{ events: AuditEvent[]; total: number }> {
      const conditions: string[] = [];
      const params: Record<string, unknown> = {};

      if (opts.actorId) { conditions.push("actor_id = @actorId"); params.actorId = opts.actorId; }
      if (opts.category) { conditions.push("category = @category"); params.category = opts.category; }
      if (opts.action) { conditions.push("action LIKE @action"); params.action = `%${opts.action}%`; }
      if (opts.outcome) { conditions.push("outcome = @outcome"); params.outcome = opts.outcome; }
      if (opts.tenantId) { conditions.push("tenant_id = @tenantId"); params.tenantId = opts.tenantId; }
      if (opts.from) { conditions.push("timestamp >= @from"); params.from = opts.from; }
      if (opts.until) { conditions.push("timestamp <= @until"); params.until = opts.until; }
      if (opts.search) {
        conditions.push("(action LIKE @search OR actor_id LIKE @search OR raw LIKE @search)");
        params.search = `%${opts.search}%`;
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;

      const countRow = db.prepare(`SELECT COUNT(*) as c FROM audit_events ${where}`).get(params) as { c: number };
      const rows = db.prepare(
        `SELECT raw FROM audit_events ${where} ORDER BY timestamp DESC LIMIT @limit OFFSET @offset`,
      ).all({ ...params, limit, offset }) as Array<{ raw: string }>;

      return {
        events: rows.map((r) => JSON.parse(r.raw) as AuditEvent),
        total: countRow.c,
      };
    },

    async getLastHash(): Promise<string | undefined> {
      const row = lastHashStmt.get() as { hash: string } | undefined;
      return row?.hash;
    },

    async count(): Promise<number> {
      const row = db.prepare("SELECT COUNT(*) as c FROM audit_events").get() as { c: number };
      return row.c;
    },

    async shutdown(): Promise<void> {
      db.close();
    },
  };
}
