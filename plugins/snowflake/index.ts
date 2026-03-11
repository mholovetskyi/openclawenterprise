/**
 * Snowflake integration plugin — audit sink + secret backend.
 *
 * Sends audit events to Snowflake via Snowpipe Streaming API
 * and reads secrets from Snowflake as a secret backend.
 *
 * Config:
 *   enterprise.plugins.pluginConfig.snowflake:
 *     account: env://SNOWFLAKE_ACCOUNT
 *     username: env://SNOWFLAKE_USER
 *     password: env://SNOWFLAKE_PASSWORD
 *     database: OPENCLAW
 *     schema: AUDIT
 *     warehouse: OPENCLAW_WH
 *     auditTable: AUDIT_EVENTS
 *     secretsTable: SECRETS
 *     batchSize: 100
 *     flushIntervalMs: 5000
 */

import type {
  AuditEvent,
  HealthCheckResult,
  PluginContext,
  PluginExports,
  PluginLifecycle,
  PluginLogger,
  SecretBackend,
  SecretMetadata,
  BatchedAuditSinkOptions,
} from "../../packages/integration-sdk/src/index.js";
import { BaseBatchedAuditSink } from "../../packages/integration-sdk/src/index.js";

// ── Snowflake connection ─────────────────────────────────────────────────────

export type SnowflakeConfig = {
  account: string;
  username: string;
  password: string;
  database: string;
  schema: string;
  warehouse?: string;
};

type SnowflakeConnection = {
  execute(sql: string, binds?: unknown[]): Promise<unknown[]>;
  close(): Promise<void>;
};

// Lazy-load snowflake-sdk
async function createSnowflakeConnection(config: SnowflakeConfig): Promise<SnowflakeConnection> {
  try {
    const sdk = (await import("snowflake-sdk")) as {
      createConnection: (opts: Record<string, unknown>) => {
        connectAsync: () => Promise<void>;
        execute: (opts: { sqlText: string; binds?: unknown[] }) => {
          getRows: () => unknown[];
        };
        destroy: (cb: (err: unknown) => void) => void;
      };
    };

    const conn = sdk.createConnection({
      account: config.account,
      username: config.username,
      password: config.password,
      database: config.database,
      schema: config.schema,
      warehouse: config.warehouse,
    });

    await conn.connectAsync();

    return {
      async execute(sql: string, binds?: unknown[]): Promise<unknown[]> {
        const stmt = conn.execute({ sqlText: sql, binds });
        return stmt.getRows();
      },
      async close(): Promise<void> {
        await new Promise<void>((resolve, reject) => {
          conn.destroy((err: unknown) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
      },
    };
  } catch {
    throw new Error(
      "Snowflake plugin requires snowflake-sdk. Install with: npm install snowflake-sdk",
    );
  }
}

// ── Snowflake Audit Sink ─────────────────────────────────────────────────────

export type SnowflakeAuditConfig = BatchedAuditSinkOptions & {
  connection: SnowflakeConnection;
  database: string;
  schema: string;
  table: string;
};

export class SnowflakeAuditSink extends BaseBatchedAuditSink {
  private config: SnowflakeAuditConfig;

  constructor(logger: PluginLogger, config: SnowflakeAuditConfig) {
    super(logger, config);
    this.config = config;
  }

  protected async flushBatch(events: AuditEvent[]): Promise<void> {
    const fqTable = `${this.config.database}.${this.config.schema}.${this.config.table}`;

    // Build a multi-row INSERT
    const columns = [
      "EVENT_ID",
      "TIMESTAMP",
      "ACTION",
      "CATEGORY",
      "OUTCOME",
      "ACTOR_TYPE",
      "ACTOR_ID",
      "ACTOR_TENANT_ID",
      "RESOURCE_TYPE",
      "RESOURCE_ID",
      "DURATION_MS",
      "METADATA",
      "HASH",
      "PREVIOUS_HASH",
    ];

    const placeholders = events.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ");

    const binds = events.flatMap((e) => [
      e.id,
      e.timestamp,
      e.action,
      e.category,
      e.outcome,
      e.actor.type,
      e.actor.id,
      e.actor.tenantId ?? null,
      e.resource?.type ?? null,
      e.resource?.id ?? null,
      e.durationMs ?? null,
      e.metadata ? JSON.stringify(e.metadata) : null,
      e.hash,
      e.previousHash ?? null,
    ]);

    const sql = `INSERT INTO ${fqTable} (${columns.join(", ")}) VALUES ${placeholders}`;
    await this.config.connection.execute(sql, binds);
  }
}

// ── Snowflake Secret Backend ─────────────────────────────────────────────────

export type SnowflakeSecretConfig = {
  connection: SnowflakeConnection;
  database: string;
  schema: string;
  table: string;
};

export class SnowflakeSecretBackend implements SecretBackend {
  readonly name = "snowflake";
  private config: SnowflakeSecretConfig;

  constructor(config: SnowflakeSecretConfig) {
    this.config = config;
  }

  private get fqTable(): string {
    return `${this.config.database}.${this.config.schema}.${this.config.table}`;
  }

  async get(ref: string): Promise<string | null> {
    const rows = (await this.config.connection.execute(
      `SELECT SECRET_VALUE FROM ${this.fqTable} WHERE SECRET_KEY = ?`,
      [ref],
    )) as Array<{ SECRET_VALUE: string }>;
    return rows.length > 0 ? rows[0].SECRET_VALUE : null;
  }

  async set(ref: string, value: string, meta?: SecretMetadata): Promise<void> {
    const existing = await this.exists(ref);
    if (existing) {
      await this.config.connection.execute(
        `UPDATE ${this.fqTable} SET SECRET_VALUE = ?, DESCRIPTION = ?, UPDATED_AT = CURRENT_TIMESTAMP() WHERE SECRET_KEY = ?`,
        [value, meta?.description ?? null, ref],
      );
    } else {
      await this.config.connection.execute(
        `INSERT INTO ${this.fqTable} (SECRET_KEY, SECRET_VALUE, DESCRIPTION, CREATED_AT) VALUES (?, ?, ?, CURRENT_TIMESTAMP())`,
        [ref, value, meta?.description ?? null],
      );
    }
  }

  async delete(ref: string): Promise<void> {
    await this.config.connection.execute(`DELETE FROM ${this.fqTable} WHERE SECRET_KEY = ?`, [ref]);
  }

  async list(): Promise<string[]> {
    const rows = (await this.config.connection.execute(
      `SELECT SECRET_KEY FROM ${this.fqTable} ORDER BY SECRET_KEY`,
    )) as Array<{ SECRET_KEY: string }>;
    return rows.map((r) => r.SECRET_KEY);
  }

  async exists(ref: string): Promise<boolean> {
    const rows = await this.config.connection.execute(
      `SELECT 1 FROM ${this.fqTable} WHERE SECRET_KEY = ? LIMIT 1`,
      [ref],
    );
    return rows.length > 0;
  }

  async shutdown(): Promise<void> {
    // Connection lifecycle managed by plugin
  }
}

// ── Plugin Lifecycle ─────────────────────────────────────────────────────────

let connection: SnowflakeConnection | null = null;

const plugin: PluginLifecycle = {
  manifest: {
    name: "snowflake",
    version: "0.1.0",
    description: "Snowflake integration — audit events and secret storage",
    capabilities: ["audit-sink", "secret-backend"],
    configSchema: {
      account: {
        type: "string",
        required: true,
        secret: true,
        description: "Snowflake account identifier",
      },
      username: { type: "string", required: true, secret: true, description: "Snowflake username" },
      password: { type: "string", required: true, secret: true, description: "Snowflake password" },
      database: { type: "string", default: "OPENCLAW", description: "Snowflake database" },
      schema: { type: "string", default: "AUDIT", description: "Snowflake schema" },
      warehouse: { type: "string", description: "Snowflake warehouse" },
      auditTable: {
        type: "string",
        default: "AUDIT_EVENTS",
        description: "Audit events table name",
      },
      secretsTable: { type: "string", default: "SECRETS", description: "Secrets table name" },
      batchSize: { type: "number", default: 100, description: "Max events per audit batch" },
      flushIntervalMs: { type: "number", default: 5000, description: "Audit flush interval in ms" },
    },
  },

  async init(ctx: PluginContext): Promise<PluginExports> {
    const [account, username, password] = await Promise.all([
      ctx.resolveSecret(ctx.config.account as string),
      ctx.resolveSecret(ctx.config.username as string),
      ctx.resolveSecret(ctx.config.password as string),
    ]);

    const database = (ctx.config.database as string) ?? "OPENCLAW";
    const schema = (ctx.config.schema as string) ?? "AUDIT";

    connection = await createSnowflakeConnection({
      account,
      username,
      password,
      database,
      schema,
      warehouse: ctx.config.warehouse as string | undefined,
    });

    const auditSink = new SnowflakeAuditSink(ctx.logger, {
      connection,
      database,
      schema,
      table: (ctx.config.auditTable as string) ?? "AUDIT_EVENTS",
      batchSize: ctx.config.batchSize as number | undefined,
      flushIntervalMs: ctx.config.flushIntervalMs as number | undefined,
    });

    const secretBackend = new SnowflakeSecretBackend({
      connection,
      database,
      schema,
      table: (ctx.config.secretsTable as string) ?? "SECRETS",
    });

    ctx.logger.info(`Connected to ${account}, database=${database}, schema=${schema}`);

    return {
      auditSinks: [auditSink],
      secretBackends: [secretBackend],
    };
  },

  async shutdown(): Promise<void> {
    if (connection) {
      await connection.close();
      connection = null;
    }
  },

  async healthCheck(): Promise<HealthCheckResult> {
    if (!connection) {
      return { status: "unhealthy", message: "Not connected" };
    }
    const start = Date.now();
    try {
      await connection.execute("SELECT 1");
      return { status: "healthy", latencyMs: Date.now() - start };
    } catch (err) {
      return {
        status: "unhealthy",
        message: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - start,
      };
    }
  },
};

export default plugin;
