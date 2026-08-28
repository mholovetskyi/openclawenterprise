/**
 * Persistent refresh-token store with revocation support.
 *
 * Refresh tokens are stored as SHA-256 hashes (never the raw token).
 * Revoked tokens are tracked until their natural expiry, then pruned.
 *
 * Storage: SQLite via better-sqlite3 (same dependency as audit + RBAC).
 */

import { createHash } from "node:crypto";
import { createRequire } from "node:module";

type DB = {
  pragma(key: string): unknown;
  exec(sql: string): void;
  prepare(sql: string): Stmt;
  close(): void;
};
type Stmt = {
  run(params?: Record<string, unknown>): void;
  get(params?: Record<string, unknown>): unknown;
  all(params?: Record<string, unknown>): unknown[];
};
type DBCtor = new (path: string) => DB;

function loadDB(): DBCtor {
  try {
    const req = createRequire(import.meta.url);
    const mod: DBCtor & { default?: DBCtor } = req("better-sqlite3");
    return mod.default ?? mod;
  } catch {
    throw new Error("Token store requires better-sqlite3. Run: npm install better-sqlite3");
  }
}

export type StoredRefreshToken = {
  jti: string; // JWT ID (the token's unique identifier)
  subjectId: string; // user or agent ID
  tokenHash: string; // SHA-256(raw refresh token)
  issuedAt: number; // unix seconds
  expiresAt: number; // unix seconds
  revoked: boolean;
  revokedAt?: number; // unix seconds
  userAgent?: string;
  ipAddress?: string;
};

export type ActiveSession = {
  jti: string;
  subjectId: string;
  issuedAt: number;
  expiresAt: number;
  userAgent?: string;
  ipAddress?: string;
};

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export class TokenStore {
  private db: DB;

  constructor(dbPath: string) {
    const Database = loadDB();
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        jti          TEXT PRIMARY KEY,
        subject_id   TEXT NOT NULL,
        token_hash   TEXT NOT NULL UNIQUE,
        issued_at    INTEGER NOT NULL,
        expires_at   INTEGER NOT NULL,
        revoked      INTEGER NOT NULL DEFAULT 0,
        revoked_at   INTEGER,
        user_agent   TEXT,
        ip_address   TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_rt_subject   ON refresh_tokens(subject_id);
      CREATE INDEX IF NOT EXISTS idx_rt_expires   ON refresh_tokens(expires_at);
      CREATE INDEX IF NOT EXISTS idx_rt_hash      ON refresh_tokens(token_hash);

      -- Access token revocation list (for forced logout / admin kill)
      CREATE TABLE IF NOT EXISTS revoked_access_tokens (
        jti        TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rat_expires ON revoked_access_tokens(expires_at);
    `);
  }

  /** Store a new refresh token after issuance. */
  storeRefreshToken(
    jti: string,
    subjectId: string,
    rawToken: string,
    issuedAt: number,
    expiresAt: number,
    meta?: { userAgent?: string; ipAddress?: string },
  ): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO refresh_tokens
          (jti, subject_id, token_hash, issued_at, expires_at, user_agent, ip_address)
         VALUES (@jti, @subjectId, @tokenHash, @issuedAt, @expiresAt, @userAgent, @ipAddress)`,
      )
      .run({
        jti,
        subjectId,
        tokenHash: hashToken(rawToken),
        issuedAt,
        expiresAt,
        userAgent: meta?.userAgent ?? null,
        ipAddress: meta?.ipAddress ?? null,
      });
  }

  /**
   * Validate a refresh token.
   * Returns the stored record if valid and not revoked, null otherwise.
   */
  validateRefreshToken(rawToken: string): StoredRefreshToken | null {
    const hash = hashToken(rawToken);
    const now = Math.floor(Date.now() / 1000);

    const row = this.db
      .prepare(
        `SELECT jti, subject_id, token_hash, issued_at, expires_at, revoked, revoked_at, user_agent, ip_address
         FROM refresh_tokens
         WHERE token_hash = @hash AND revoked = 0 AND expires_at > @now`,
      )
      // SAFETY: the prepared SELECT names exactly these refresh_tokens columns, so a matched row has this shape; .get() returns undefined when no row matches.
      .get({ hash, now }) as
      | {
          jti: string;
          subject_id: string;
          token_hash: string;
          issued_at: number;
          expires_at: number;
          revoked: number;
          revoked_at: number | null;
          user_agent: string | null;
          ip_address: string | null;
        }
      | undefined;

    if (!row) return null;

    return {
      jti: row.jti,
      subjectId: row.subject_id,
      tokenHash: row.token_hash,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      revoked: row.revoked === 1,
      revokedAt: row.revoked_at ?? undefined,
      userAgent: row.user_agent ?? undefined,
      ipAddress: row.ip_address ?? undefined,
    };
  }

  /**
   * Revoke a single refresh token by JTI.
   * Used when rotating (single-use) or on explicit logout.
   */
  revokeRefreshToken(jti: string): void {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare("UPDATE refresh_tokens SET revoked = 1, revoked_at = @now WHERE jti = @jti")
      .run({ jti, now });
  }

  /** Revoke ALL refresh tokens for a subject (force-logout). Returns count revoked. */
  revokeAllForSubject(subjectId: string): number {
    const now = Math.floor(Date.now() / 1000);
    // Count active (non-revoked, non-expired) tokens before revoking
    const countRow = this.db
      .prepare(
        "SELECT COUNT(*) as c FROM refresh_tokens WHERE subject_id = @subjectId AND revoked = 0 AND expires_at > @now",
      )
      // SAFETY: SELECT COUNT(*) as c always returns exactly one row with a numeric `c`.
      .get({ subjectId, now }) as { c: number };
    const count = countRow.c;

    this.db
      .prepare(
        "UPDATE refresh_tokens SET revoked = 1, revoked_at = @now WHERE subject_id = @subjectId AND revoked = 0",
      )
      .run({ subjectId, now });

    return count;
  }

  /** List active (non-revoked, non-expired) sessions for a subject. */
  listActiveSessions(subjectId: string): ActiveSession[] {
    const now = Math.floor(Date.now() / 1000);
    const rows = this.db
      .prepare(
        `SELECT jti, subject_id, issued_at, expires_at, user_agent, ip_address
         FROM refresh_tokens
         WHERE subject_id = @subjectId AND revoked = 0 AND expires_at > @now
         ORDER BY issued_at DESC`,
      )
      // SAFETY: the prepared SELECT names exactly these refresh_tokens columns, so each returned row has this shape.
      .all({ subjectId, now }) as Array<{
      jti: string;
      subject_id: string;
      issued_at: number;
      expires_at: number;
      user_agent: string | null;
      ip_address: string | null;
    }>;

    return rows.map((r) => ({
      jti: r.jti,
      subjectId: r.subject_id,
      issuedAt: r.issued_at,
      expiresAt: r.expires_at,
      userAgent: r.user_agent ?? undefined,
      ipAddress: r.ip_address ?? undefined,
    }));
  }

  /** Revoke an access token by JTI (immediately invalidates until natural expiry). */
  revokeAccessToken(jti: string, expiresAt: number): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO revoked_access_tokens (jti, expires_at) VALUES (@jti, @expiresAt)",
      )
      .run({ jti, expiresAt });
  }

  /** Check if an access token JTI has been revoked. */
  isAccessTokenRevoked(jti: string): boolean {
    const now = Math.floor(Date.now() / 1000);
    const row = this.db
      .prepare("SELECT 1 FROM revoked_access_tokens WHERE jti = @jti AND expires_at > @now")
      .get({ jti, now });
    return row !== undefined;
  }

  /** Prune expired tokens to keep the DB compact. Call periodically (e.g. hourly). */
  prune(): number {
    const now = Math.floor(Date.now() / 1000);
    this.db.prepare("DELETE FROM refresh_tokens WHERE expires_at <= @now").run({ now });
    this.db.prepare("DELETE FROM revoked_access_tokens WHERE expires_at <= @now").run({ now });
    // SAFETY: SELECT changes() as c always returns one row with a numeric `c`.
    const row = this.db.prepare("SELECT changes() as c").get() as { c: number };
    return row.c;
  }

  close(): void {
    this.db.close();
  }
}
