/**
 * SQLite-backed RBAC store.
 *
 * Persists users, roles, groups, and agent identities across restarts.
 * Uses the same better-sqlite3 dependency as the audit log backend.
 * WAL mode for concurrent reads with crash-safe writes.
 */

import { createRequire } from "node:module";
import type { Role, User, Group, AgentIdentity } from "./model.js";
import type { RBACStore } from "./store.js";

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
    throw new Error("SQLite RBAC backend requires better-sqlite3. Run: npm install better-sqlite3");
  }
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS rbac_roles (
    id      TEXT PRIMARY KEY,
    raw     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rbac_users (
    id           TEXT PRIMARY KEY,
    email        TEXT,
    tenant_id    TEXT,
    raw          TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_rbac_users_email     ON rbac_users(email);
  CREATE INDEX IF NOT EXISTS idx_rbac_users_tenant    ON rbac_users(tenant_id);

  CREATE TABLE IF NOT EXISTS rbac_groups (
    id        TEXT PRIMARY KEY,
    tenant_id TEXT,
    raw       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_rbac_groups_tenant ON rbac_groups(tenant_id);

  CREATE TABLE IF NOT EXISTS rbac_agents (
    id            TEXT PRIMARY KEY,
    api_key_hash  TEXT,
    tenant_id     TEXT,
    raw           TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_rbac_agents_key    ON rbac_agents(api_key_hash);
  CREATE INDEX IF NOT EXISTS idx_rbac_agents_tenant ON rbac_agents(tenant_id);

  -- channel_id index stored as a separate lookup table for O(1) lookup
  CREATE TABLE IF NOT EXISTS rbac_user_channels (
    user_id    TEXT NOT NULL,
    channel    TEXT NOT NULL,
    channel_uid TEXT NOT NULL,
    PRIMARY KEY (channel, channel_uid)
  );
`;

export function createSQLiteRBACStore(dbPath: string): RBACStore {
  const Database = loadDB();
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  // ── helpers ────────────────────────────────────────────────────────────────

  function parseRow<T>(row: unknown): T {
    // Callers pass a row from a `SELECT raw FROM rbac_*` prepared statement, so `raw` is
    // the TEXT column holding the stringified entity written by the matching upsert*.
    // SAFETY: `row` has a string `raw` column and JSON.parse reconstructs that T (a corrupt row throws here).
    return JSON.parse((row as { raw: string }).raw) as T;
  }

  // ── Roles ──────────────────────────────────────────────────────────────────

  return {
    async listRoles(): Promise<Role[]> {
      // SAFETY: SELECT raw FROM rbac_roles returns rows whose `raw` column is TEXT.
      return (db.prepare("SELECT raw FROM rbac_roles").all() as Array<{ raw: string }>).map((r) =>
        parseRow<Role>(r),
      );
    },

    async getRole(id: string): Promise<Role | null> {
      const row = db.prepare("SELECT raw FROM rbac_roles WHERE id = @id").get({ id });
      return row ? parseRow<Role>(row) : null;
    },

    async upsertRole(role: Role): Promise<void> {
      db.prepare("INSERT OR REPLACE INTO rbac_roles (id, raw) VALUES (@id, @raw)").run({
        id: role.id,
        raw: JSON.stringify(role),
      });
    },

    async deleteRole(id: string): Promise<void> {
      db.prepare("DELETE FROM rbac_roles WHERE id = @id").run({ id });
    },

    // ── Users ────────────────────────────────────────────────────────────────

    async listUsers(tenantId?: string): Promise<User[]> {
      const rows = tenantId
        ? (db
            .prepare("SELECT raw FROM rbac_users WHERE tenant_id = @tenantId")
            // SAFETY: SELECT raw FROM rbac_users returns rows whose `raw` column is TEXT.
            .all({ tenantId }) as Array<{ raw: string }>)
        : // SELECT raw FROM rbac_users returns rows whose `raw` column is TEXT.
          (db.prepare("SELECT raw FROM rbac_users").all() as Array<{ raw: string }>); // SAFETY: `raw` column is TEXT.
      return rows.map((r) => parseRow<User>(r));
    },

    async getUser(id: string): Promise<User | null> {
      const row = db.prepare("SELECT raw FROM rbac_users WHERE id = @id").get({ id });
      return row ? parseRow<User>(row) : null;
    },

    async getUserByEmail(email: string): Promise<User | null> {
      const row = db.prepare("SELECT raw FROM rbac_users WHERE email = @email").get({ email });
      return row ? parseRow<User>(row) : null;
    },

    async getUserByExternalId(externalId: string): Promise<User | null> {
      // external_id stored as JSON field — scan is acceptable at enterprise scale
      // SAFETY: SELECT raw FROM rbac_users returns rows whose `raw` column is TEXT.
      const rows = db.prepare("SELECT raw FROM rbac_users").all() as Array<{ raw: string }>;
      for (const r of rows) {
        const u = parseRow<User>(r);
        if (u.externalId === externalId) return u;
      }
      return null;
    },

    async getUserByChannelId(channel: string, channelUserId: string): Promise<User | null> {
      const row = db
        .prepare(
          "SELECT u.raw FROM rbac_user_channels c JOIN rbac_users u ON u.id = c.user_id " +
            "WHERE c.channel = @channel AND c.channel_uid = @channelUserId",
        )
        .get({ channel, channelUserId });
      return row ? parseRow<User>(row) : null;
    },

    async upsertUser(user: User): Promise<void> {
      db.prepare(
        "INSERT OR REPLACE INTO rbac_users (id, email, tenant_id, raw) VALUES (@id, @email, @tenantId, @raw)",
      ).run({
        id: user.id,
        email: user.email ?? null,
        tenantId: user.tenantId ?? null,
        raw: JSON.stringify(user),
      });

      // Rebuild channel index for this user
      db.prepare("DELETE FROM rbac_user_channels WHERE user_id = @userId").run({ userId: user.id });
      if (user.channelIds) {
        for (const [channel, channelUid] of Object.entries(user.channelIds)) {
          db.prepare(
            "INSERT OR REPLACE INTO rbac_user_channels (user_id, channel, channel_uid) VALUES (@userId, @channel, @channelUid)",
          ).run({ userId: user.id, channel, channelUid });
        }
      }
    },

    async deleteUser(id: string): Promise<void> {
      db.prepare("DELETE FROM rbac_user_channels WHERE user_id = @id").run({ id });
      db.prepare("DELETE FROM rbac_users WHERE id = @id").run({ id });
    },

    // ── Groups ───────────────────────────────────────────────────────────────

    async listGroups(tenantId?: string): Promise<Group[]> {
      const rows = tenantId
        ? (db
            .prepare("SELECT raw FROM rbac_groups WHERE tenant_id = @tenantId")
            // SAFETY: SELECT raw FROM rbac_groups returns rows whose `raw` column is TEXT.
            .all({ tenantId }) as Array<{ raw: string }>)
        : // SELECT raw FROM rbac_groups returns rows whose `raw` column is TEXT.
          (db.prepare("SELECT raw FROM rbac_groups").all() as Array<{ raw: string }>); // SAFETY: `raw` column is TEXT.
      return rows.map((r) => parseRow<Group>(r));
    },

    async getGroup(id: string): Promise<Group | null> {
      const row = db.prepare("SELECT raw FROM rbac_groups WHERE id = @id").get({ id });
      return row ? parseRow<Group>(row) : null;
    },

    async upsertGroup(group: Group): Promise<void> {
      db.prepare(
        "INSERT OR REPLACE INTO rbac_groups (id, tenant_id, raw) VALUES (@id, @tenantId, @raw)",
      ).run({ id: group.id, tenantId: group.tenantId ?? null, raw: JSON.stringify(group) });
    },

    async deleteGroup(id: string): Promise<void> {
      db.prepare("DELETE FROM rbac_groups WHERE id = @id").run({ id });
    },

    // ── Agent identities ─────────────────────────────────────────────────────

    async listAgentIdentities(tenantId?: string): Promise<AgentIdentity[]> {
      const rows = tenantId
        ? (db
            .prepare("SELECT raw FROM rbac_agents WHERE tenant_id = @tenantId")
            // SAFETY: SELECT raw FROM rbac_agents returns rows whose `raw` column is TEXT.
            .all({ tenantId }) as Array<{ raw: string }>)
        : // SELECT raw FROM rbac_agents returns rows whose `raw` column is TEXT.
          (db.prepare("SELECT raw FROM rbac_agents").all() as Array<{ raw: string }>); // SAFETY: `raw` column is TEXT.
      return rows.map((r) => parseRow<AgentIdentity>(r));
    },

    async getAgentIdentity(id: string): Promise<AgentIdentity | null> {
      const row = db.prepare("SELECT raw FROM rbac_agents WHERE id = @id").get({ id });
      return row ? parseRow<AgentIdentity>(row) : null;
    },

    async getAgentIdentityByApiKeyHash(hash: string): Promise<AgentIdentity | null> {
      const row = db
        .prepare("SELECT raw FROM rbac_agents WHERE api_key_hash = @hash")
        .get({ hash });
      return row ? parseRow<AgentIdentity>(row) : null;
    },

    async upsertAgentIdentity(identity: AgentIdentity): Promise<void> {
      db.prepare(
        "INSERT OR REPLACE INTO rbac_agents (id, api_key_hash, tenant_id, raw) VALUES (@id, @apiKeyHash, @tenantId, @raw)",
      ).run({
        id: identity.id,
        apiKeyHash: identity.apiKeyHash ?? null,
        tenantId: identity.tenantId ?? null,
        raw: JSON.stringify(identity),
      });
    },

    async deleteAgentIdentity(id: string): Promise<void> {
      db.prepare("DELETE FROM rbac_agents WHERE id = @id").run({ id });
    },
  };
}
