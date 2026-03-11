import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildTestEvent,
  buildTestEvents,
  createTestContext,
} from "../../packages/integration-sdk/src/testing.js";
import { SnowflakeAuditSink, SnowflakeSecretBackend } from "./index.js";

// Mock Snowflake connection
function createMockConnection() {
  const secrets = new Map<string, string>();
  const executedSql: Array<{ sql: string; binds?: unknown[] }> = [];

  return {
    executedSql,
    secrets,
    async execute(sql: string, binds?: unknown[]): Promise<unknown[]> {
      executedSql.push({ sql, binds });

      // Health check
      if (sql === "SELECT 1") {
        return [{ "1": 1 }];
      }

      // Secret existence check (SELECT 1 FROM ... LIMIT 1)
      if (sql.includes("LIMIT 1")) {
        const key = binds?.[0] as string;
        return secrets.has(key) ? [{ "1": 1 }] : [];
      }

      // Get secret value
      if (sql.includes("SELECT SECRET_VALUE")) {
        const key = binds?.[0] as string;
        const val = secrets.get(key);
        return val !== undefined ? [{ SECRET_VALUE: val }] : [];
      }

      // List secret keys
      if (sql.includes("SELECT SECRET_KEY")) {
        return [...secrets.keys()].map((k) => ({ SECRET_KEY: k }));
      }

      // Delete
      if (sql.startsWith("DELETE")) {
        const key = binds?.[0] as string;
        secrets.delete(key);
        return [];
      }

      // INSERT for secrets
      if (sql.includes("SECRET_KEY, SECRET_VALUE")) {
        const key = binds?.[0] as string;
        const value = binds?.[1] as string;
        secrets.set(key, value);
        return [];
      }

      // UPDATE for secrets
      if (sql.startsWith("UPDATE")) {
        const value = binds?.[0] as string;
        const key = binds?.[2] as string;
        secrets.set(key, value);
        return [];
      }

      // Everything else (including audit INSERT)
      return [];
    },
    async close(): Promise<void> {},
  };
}

describe("snowflake plugin", () => {
  let mockConn: ReturnType<typeof createMockConnection>;
  let logger: ReturnType<typeof createTestContext>["logger"];

  beforeEach(() => {
    vi.restoreAllMocks();
    mockConn = createMockConnection();
    logger = createTestContext().logger;
  });

  describe("SnowflakeAuditSink", () => {
    it("inserts events into Snowflake table", async () => {
      const sink = new SnowflakeAuditSink(logger, {
        connection: mockConn,
        database: "OPENCLAW",
        schema: "AUDIT",
        table: "AUDIT_EVENTS",
        batchSize: 3,
      });

      const events = buildTestEvents(3, { action: "agent.run.start", category: "agent" });
      for (const e of events) {
        await sink.send(e);
      }

      const insertCalls = mockConn.executedSql.filter((s) => s.sql.startsWith("INSERT"));
      expect(insertCalls).toHaveLength(1);
      expect(insertCalls[0].sql).toContain("OPENCLAW.AUDIT.AUDIT_EVENTS");
      expect(insertCalls[0].binds).toHaveLength(3 * 14); // 3 events × 14 columns

      await sink.close();
    });

    it("flushes remaining events on close", async () => {
      const sink = new SnowflakeAuditSink(logger, {
        connection: mockConn,
        database: "DB",
        schema: "SCH",
        table: "TBL",
        batchSize: 100,
      });

      await sink.send(buildTestEvent());
      await sink.send(buildTestEvent());
      await sink.close();

      const insertCalls = mockConn.executedSql.filter((s) => s.sql.startsWith("INSERT"));
      expect(insertCalls).toHaveLength(1);
      expect(insertCalls[0].binds).toHaveLength(2 * 14);
    });
  });

  describe("SnowflakeSecretBackend", () => {
    let backend: SnowflakeSecretBackend;

    beforeEach(() => {
      backend = new SnowflakeSecretBackend({
        connection: mockConn,
        database: "OPENCLAW",
        schema: "AUDIT",
        table: "SECRETS",
      });
    });

    it("returns null for missing secrets", async () => {
      const result = await backend.get("nonexistent");
      expect(result).toBeNull();
    });

    it("sets and retrieves secrets", async () => {
      await backend.set("my-key", "my-value", { description: "test" });

      const insertCalls = mockConn.executedSql.filter((s) =>
        s.sql.includes("SECRET_KEY, SECRET_VALUE"),
      );
      expect(insertCalls.length).toBeGreaterThan(0);
    });

    it("lists secret keys", async () => {
      // Pre-populate mock
      mockConn.secrets.set("key1", "val1");
      mockConn.secrets.set("key2", "val2");

      const keys = await backend.list();
      expect(keys).toContain("key1");
      expect(keys).toContain("key2");
    });

    it("checks existence", async () => {
      mockConn.secrets.set("exists-key", "val");

      expect(await backend.exists("exists-key")).toBe(true);
      expect(await backend.exists("missing-key")).toBe(false);
    });

    it("deletes secrets", async () => {
      await backend.delete("some-key");
      const deleteCalls = mockConn.executedSql.filter((s) => s.sql.startsWith("DELETE"));
      expect(deleteCalls).toHaveLength(1);
    });

    it("has name 'snowflake'", () => {
      expect(backend.name).toBe("snowflake");
    });
  });
});
