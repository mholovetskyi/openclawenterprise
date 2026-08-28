/**
 * SQLite audit log storage backend.
 * Uses WAL mode for concurrent reads, with hash chain integrity.
 */

import { createRequire } from "node:module";
import { anonymizeEventActor, type AuditEvent } from "../schema.js";

export type AuditQueryOptions = {
  limit?: number;
  offset?: number;
  actorId?: string;
  category?: string;
  action?: string;
  outcome?: string;
  tenantId?: string;
  ip?: string;
  from?: string; // ISO 8601
  until?: string; // ISO 8601
  search?: string;
};

/** The true tail of the chain — used to seed the in-memory head on startup. */
export type AuditChainHead = { hash: string; seq: number };

export interface AuditStorage {
  append(event: AuditEvent): Promise<void>;
  query(opts: AuditQueryOptions): Promise<{ events: AuditEvent[]; total: number }>;
  getLastHash(): Promise<string | undefined>;
  /**
   * Return the hash AND seq of the true tail (by insertion order), for seeding
   * the chain head across restarts. Optional for backward compatibility.
   */
  getHead?(): Promise<AuditChainHead | undefined>;
  count(): Promise<number>;
  shutdown(): Promise<void>;
  /** GDPR: replace all occurrences of actorId with pseudonym. Returns rows affected. */
  anonymizeActor?(actorId: string, pseudonym: string): Promise<number>;
}

/**
 * SQLite-backed audit storage.
 * Dynamically imports `better-sqlite3` to avoid hard dependency.
 */
// Minimal DB interface — avoids a compile-time dependency on @types/better-sqlite3
type BetterSQLiteDB = {
  pragma(key: string): unknown;
  exec(sql: string): void;
  prepare(sql: string): {
    run(params?: Record<string, unknown>): { changes: number };
    get(params?: Record<string, unknown>): unknown;
    all(params?: Record<string, unknown>): unknown[];
  };
  close(): void;
};
type BetterSQLiteCtor = new (path: string) => BetterSQLiteDB;

export async function createSQLiteAuditStorage(dbPath: string): Promise<AuditStorage> {
  let Database: BetterSQLiteCtor;
  try {
    // Use createRequire so TypeScript doesn't statically resolve this optional dep
    const _req = createRequire(import.meta.url);
    const mod: BetterSQLiteCtor & { default?: BetterSQLiteCtor } = _req("better-sqlite3");
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
      seq         INTEGER,
      timestamp   TEXT NOT NULL,
      actor_id    TEXT NOT NULL,
      actor_type  TEXT NOT NULL,
      actor_email TEXT,
      actor_ip    TEXT,
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
    CREATE INDEX IF NOT EXISTS idx_audit_actor_ip   ON audit_events(actor_ip);
    CREATE INDEX IF NOT EXISTS idx_audit_action     ON audit_events(action);
    CREATE INDEX IF NOT EXISTS idx_audit_category   ON audit_events(category);
    CREATE INDEX IF NOT EXISTS idx_audit_outcome    ON audit_events(outcome);
    CREATE INDEX IF NOT EXISTS idx_audit_tenant     ON audit_events(tenant_id);
  `);

  // Plain INSERT (not INSERT OR IGNORE): an id collision or an ignored insert
  // must surface as an error rather than silently dropping an audit record and
  // poisoning the hash chain. append() checks changes and throws on 0 rows.
  const insertStmt = db.prepare(`
    INSERT INTO audit_events
      (id, seq, timestamp, actor_id, actor_type, actor_email, actor_ip, action, category,
       resource_id, resource_type, outcome, duration_ms, tenant_id, error_msg,
       previous_hash, hash, metadata, raw)
    VALUES
      (@id, @seq, @timestamp, @actor_id, @actor_type, @actor_email, @actor_ip, @action, @category,
       @resource_id, @resource_type, @outcome, @duration_ms, @tenant_id, @error_msg,
       @previous_hash, @hash, @metadata, @raw)
  `);

  // Order by rowid (implicit, insertion-monotonic — the table is not WITHOUT
  // ROWID) rather than the coarse millisecond timestamp, so same-millisecond
  // ties and backward clock steps still return the true tail.
  const lastHashStmt = db.prepare("SELECT hash FROM audit_events ORDER BY rowid DESC LIMIT 1");
  const headStmt = db.prepare("SELECT hash, seq FROM audit_events ORDER BY rowid DESC LIMIT 1");

  return {
    async append(event: AuditEvent): Promise<void> {
      const info = insertStmt.run({
        id: event.id,
        seq: event.seq ?? null,
        timestamp: event.timestamp,
        actor_id: event.actor.id,
        actor_type: event.actor.type,
        actor_email: event.actor.email ?? null,
        actor_ip: event.actor.ip ?? null,
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
      if (info.changes === 0) {
        // An ignored/failed insert must not be treated as a durable write.
        throw new Error(`audit append failed: event ${event.id} was not persisted`);
      }
    },

    async query(opts: AuditQueryOptions): Promise<{ events: AuditEvent[]; total: number }> {
      const conditions: string[] = [];
      const params: Record<string, unknown> = {};

      if (opts.actorId) {
        conditions.push("actor_id = @actorId");
        params.actorId = opts.actorId;
      }
      if (opts.category) {
        conditions.push("category = @category");
        params.category = opts.category;
      }
      if (opts.action) {
        conditions.push("action LIKE @action");
        params.action = `%${opts.action}%`;
      }
      if (opts.outcome) {
        conditions.push("outcome = @outcome");
        params.outcome = opts.outcome;
      }
      if (opts.tenantId) {
        conditions.push("tenant_id = @tenantId");
        params.tenantId = opts.tenantId;
      }
      if (opts.ip) {
        conditions.push("actor_ip = @ip");
        params.ip = opts.ip;
      }
      if (opts.from) {
        conditions.push("timestamp >= @from");
        params.from = opts.from;
      }
      if (opts.until) {
        conditions.push("timestamp <= @until");
        params.until = opts.until;
      }
      if (opts.search) {
        conditions.push("(action LIKE @search OR actor_id LIKE @search OR raw LIKE @search)");
        params.search = `%${opts.search}%`;
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;

      const countRow = db
        .prepare(`SELECT COUNT(*) as c FROM audit_events ${where}`)
        // SAFETY: SELECT COUNT(*) as c always returns one row with a numeric `c`.
        .get(params) as { c: number };
      const rows = db
        .prepare(
          `SELECT raw FROM audit_events ${where} ORDER BY timestamp DESC LIMIT @limit OFFSET @offset`,
        )
        // SAFETY: SELECT raw returns rows whose `raw` column is a TEXT string.
        .all({ ...params, limit, offset }) as Array<{ raw: string }>;

      return {
        // SAFETY: raw is written only by append() serializing a full AuditEvent.
        events: rows.map((r) => JSON.parse(r.raw) as AuditEvent),
        total: countRow.c,
      };
    },

    async getLastHash(): Promise<string | undefined> {
      // SAFETY: lastHashStmt selects the `hash` column; .get() is that row or undefined.
      const row = lastHashStmt.get() as { hash: string } | undefined;
      return row?.hash;
    },

    async getHead(): Promise<{ hash: string; seq: number } | undefined> {
      // SAFETY: headStmt selects `hash` and `seq`; .get() is that row or undefined.
      const row = headStmt.get() as { hash: string; seq: number | null } | undefined;
      if (!row) return undefined;
      return { hash: row.hash, seq: row.seq ?? 0 };
    },

    async count(): Promise<number> {
      // SAFETY: SELECT COUNT(*) as c always returns one row with a numeric `c`.
      const row = db.prepare("SELECT COUNT(*) as c FROM audit_events").get() as { c: number };
      return row.c;
    },

    async shutdown(): Promise<void> {
      db.close();
    },

    async anonymizeActor(actorId: string, pseudonym: string): Promise<number> {
      // Update indexed columns — also NULL out the queryable/erasable IP column.
      db.prepare(
        "UPDATE audit_events SET actor_id = @pseudo, actor_email = NULL, actor_ip = NULL WHERE actor_id = @actorId",
      ).run({ pseudo: pseudonym, actorId });

      // Rewrite raw JSON blobs — strip ALL erasable actor PII (id→pseudonym;
      // name/email/ip/channel/channelUserId/sessionId removed). Because those
      // fields are excluded from the hash pre-image, the rewritten event still
      // passes verifyEventHash and the chain stays intact (verified by test).
      const rows = db
        .prepare("SELECT id, raw FROM audit_events WHERE actor_id = @pseudo")
        // SAFETY: the prepared SELECT names `id` and `raw`, both TEXT columns.
        .all({ pseudo: pseudonym }) as Array<{ id: string; raw: string }>;

      let count = 0;
      for (const row of rows) {
        try {
          // The raw column is written only by append() from a full AuditEvent.
          // SAFETY: a malformed row throws in JSON.parse and is skipped by the catch below.
          const event = JSON.parse(row.raw) as AuditEvent;
          const erased = anonymizeEventActor(event, pseudonym);
          db.prepare("UPDATE audit_events SET raw = @raw WHERE id = @id").run({
            raw: JSON.stringify(erased),
            id: row.id,
          });
          count++;
        } catch {
          // Skip malformed rows
        }
      }
      return count;
    },
  };
}
