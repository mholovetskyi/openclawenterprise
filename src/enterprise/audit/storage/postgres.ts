/**
 * PostgreSQL audit log storage backend.
 *
 * Provides the same AuditStorage interface as the SQLite backend but stores
 * events in a managed PostgreSQL database — suitable for HA deployments,
 * centralized audit log aggregation, and compliance archival.
 *
 * Uses the `pg` npm package (optional dependency).
 *
 * Config:
 *   enterprise:
 *     audit:
 *       storage:
 *         driver: postgres
 *         connectionString: env://AUDIT_DB_URL
 *         # or:
 *         host: audit-db.internal
 *         port: 5432
 *         database: openclaw_audit
 *         user: openclaw
 *         password: env://AUDIT_DB_PASSWORD
 *         ssl: true
 */

import { createRequire } from "node:module";
import { anonymizeEventActor, type AuditEvent } from "../schema.js";
import type { AuditStorage, AuditQueryOptions } from "./sqlite.js";

// ── pg type shim ───────────────────────────────────────────────────────────────

type PoolConfig = {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean | { rejectUnauthorized?: boolean };
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
};

type QueryResult<R> = { rows: R[]; rowCount: number | null };

type Pool = {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<R>>;
  end(): Promise<void>;
};

type PoolCtor = new (config: PoolConfig) => Pool;

function loadPg(): PoolCtor {
  try {
    const req = createRequire(import.meta.url);
    const mod: { Pool?: PoolCtor; default?: { Pool?: PoolCtor } } = req("pg");
    const ctor = mod.Pool ?? mod.default?.Pool;
    if (!ctor) {
      throw new Error("pg module does not export Pool");
    }
    return ctor;
  } catch {
    throw new Error("PostgreSQL audit backend requires pg. Run: npm install pg");
  }
}

// ── Schema ─────────────────────────────────────────────────────────────────────

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS audit_events (
    id             TEXT PRIMARY KEY,
    ins_seq        BIGINT GENERATED ALWAYS AS IDENTITY,
    seq            BIGINT,
    timestamp      TIMESTAMPTZ NOT NULL,
    actor_id       TEXT NOT NULL,
    actor_type     TEXT NOT NULL,
    actor_email    TEXT,
    actor_ip       TEXT,
    action         TEXT NOT NULL,
    category       TEXT NOT NULL,
    resource_id    TEXT,
    resource_type  TEXT,
    outcome        TEXT NOT NULL,
    duration_ms    INTEGER,
    tenant_id      TEXT,
    error_msg      TEXT,
    previous_hash  TEXT,
    hash           TEXT NOT NULL,
    metadata       JSONB,
    raw            JSONB NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_audit_ins_seq   ON audit_events(ins_seq);
  CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp);
  CREATE INDEX IF NOT EXISTS idx_audit_actor_id  ON audit_events(actor_id);
  CREATE INDEX IF NOT EXISTS idx_audit_actor_ip  ON audit_events(actor_ip);
  CREATE INDEX IF NOT EXISTS idx_audit_action    ON audit_events(action);
  CREATE INDEX IF NOT EXISTS idx_audit_category  ON audit_events(category);
  CREATE INDEX IF NOT EXISTS idx_audit_outcome   ON audit_events(outcome);
  CREATE INDEX IF NOT EXISTS idx_audit_tenant    ON audit_events(tenant_id);
`;

// ── Factory ────────────────────────────────────────────────────────────────────

export async function createPostgresAuditStorage(config: PoolConfig): Promise<AuditStorage> {
  const PoolClass = loadPg();
  const pool = new PoolClass({
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...config,
  });

  // Initialize schema
  await pool.query(SCHEMA);

  return {
    async append(event: AuditEvent): Promise<void> {
      // Plain INSERT (no ON CONFLICT DO NOTHING): an id collision must surface as
      // an error, not silently drop the record and poison the hash chain.
      const result = await pool.query(
        `INSERT INTO audit_events
           (id, seq, timestamp, actor_id, actor_type, actor_email, actor_ip, action, category,
            resource_id, resource_type, outcome, duration_ms, tenant_id, error_msg,
            previous_hash, hash, metadata, raw)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          event.id,
          event.seq ?? null,
          event.timestamp,
          event.actor.id,
          event.actor.type,
          event.actor.email ?? null,
          event.actor.ip ?? null,
          event.action,
          event.category,
          event.resource?.id ?? null,
          event.resource?.type ?? null,
          event.outcome,
          event.durationMs ?? null,
          event.actor.tenantId ?? null,
          event.errorMessage ?? null,
          event.previousHash ?? null,
          event.hash,
          event.metadata ? JSON.stringify(event.metadata) : null,
          JSON.stringify(event),
        ],
      );
      if (result.rowCount === 0) {
        throw new Error(`audit append failed: event ${event.id} was not persisted`);
      }
    },

    async query(opts: AuditQueryOptions): Promise<{ events: AuditEvent[]; total: number }> {
      const conditions: string[] = [];
      const params: unknown[] = [];
      let i = 1;

      function add(cond: string, val: unknown) {
        conditions.push(cond.replace("?", `$${i++}`));
        params.push(val);
      }

      if (opts.actorId) add("actor_id = ?", opts.actorId);
      if (opts.category) add("category = ?", opts.category);
      if (opts.action) add("action ILIKE ?", `%${opts.action}%`);
      if (opts.outcome) add("outcome = ?", opts.outcome);
      if (opts.tenantId) add("tenant_id = ?", opts.tenantId);
      if (opts.ip) add("actor_ip = ?", opts.ip);
      if (opts.from) add("timestamp >= ?", opts.from);
      if (opts.until) add("timestamp <= ?", opts.until);
      if (opts.search) {
        conditions.push(`(action ILIKE $${i} OR actor_id ILIKE $${i} OR raw::text ILIKE $${i})`);
        params.push(`%${opts.search}%`);
        i++;
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;

      const countResult = await pool.query<{ c: string }>(
        `SELECT COUNT(*) AS c FROM audit_events ${where}`,
        params,
      );
      const total = parseInt(countResult.rows[0]?.c ?? "0", 10);

      const rows = await pool.query<{ raw: unknown }>(
        `SELECT raw FROM audit_events ${where} ORDER BY timestamp DESC LIMIT $${i} OFFSET $${i + 1}`,
        [...params, limit, offset],
      );

      return {
        events: rows.rows.map((r) =>
          // SAFETY: raw is written only by append() serializing a full AuditEvent; JSONB returns it here already parsed as that object.
          typeof r.raw === "string" ? JSON.parse(r.raw) : (r.raw as AuditEvent),
        ),
        total,
      };
    },

    async getLastHash(): Promise<string | undefined> {
      // Order by the monotonic insertion identity, not the coarse timestamp, so
      // same-millisecond ties and backward clock steps still return the true tail.
      const result = await pool.query<{ hash: string }>(
        "SELECT hash FROM audit_events ORDER BY ins_seq DESC LIMIT 1",
      );
      return result.rows[0]?.hash;
    },

    async getHead(): Promise<{ hash: string; seq: number } | undefined> {
      const result = await pool.query<{ hash: string; seq: string | number | null }>(
        "SELECT hash, seq FROM audit_events ORDER BY ins_seq DESC LIMIT 1",
      );
      const row = result.rows[0];
      if (!row) return undefined;
      const seq = row.seq === null || row.seq === undefined ? 0 : Number(row.seq);
      return { hash: row.hash, seq };
    },

    async count(): Promise<number> {
      const result = await pool.query<{ c: string }>("SELECT COUNT(*) AS c FROM audit_events");
      return parseInt(result.rows[0]?.c ?? "0", 10);
    },

    async shutdown(): Promise<void> {
      await pool.end();
    },

    async anonymizeActor(actorId: string, pseudonym: string): Promise<number> {
      // Update indexed columns — also NULL out the queryable/erasable IP column.
      await pool.query(
        "UPDATE audit_events SET actor_id = $1, actor_email = NULL, actor_ip = NULL WHERE actor_id = $2",
        [pseudonym, actorId],
      );

      // Rewrite JSONB blobs — strip ALL erasable actor PII. Those fields are
      // excluded from the hash pre-image, so the rewritten event still verifies
      // and the chain stays intact.
      const result = await pool.query<{ id: string; raw: AuditEvent | string }>(
        "SELECT id, raw FROM audit_events WHERE actor_id = $1",
        [pseudonym],
      );

      let count = 0;
      for (const row of result.rows) {
        try {
          // The raw JSONB column is written only by append() from a full AuditEvent.
          // SAFETY: a malformed row throws in JSON.parse and is skipped by the catch below.
          const event = (typeof row.raw === "string" ? JSON.parse(row.raw) : row.raw) as AuditEvent;
          const erased = anonymizeEventActor(event, pseudonym);
          await pool.query("UPDATE audit_events SET raw = $1 WHERE id = $2", [
            JSON.stringify(erased),
            row.id,
          ]);
          count++;
        } catch {
          // Skip
        }
      }
      return count;
    },
  };
}
