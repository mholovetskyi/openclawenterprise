import { describe, it, expect } from "vitest";
import type { GuardrailRule } from "./interfaces.js";
import type { PluginLifecycle } from "./lifecycle.js";
import {
  buildTestEvent,
  buildTestEvents,
  createCollectorSink,
  createMemorySecretBackend,
  createTestContext,
  createTestLogger,
  buildTestGuardrailContext,
  assertRuleAction,
  initTestPlugin,
} from "./testing.js";

describe("testing utilities", () => {
  describe("createTestLogger", () => {
    it("collects log entries", () => {
      const logger = createTestLogger();
      logger.info("hello", { key: "val" });
      logger.warn("warning");
      logger.error("error");
      logger.debug("debug");

      expect(logger.entries).toHaveLength(4);
      expect(logger.entries[0]).toEqual({ level: "info", msg: "hello", data: { key: "val" } });
    });
  });

  describe("createTestContext", () => {
    it("creates context with config and secrets", async () => {
      const ctx = createTestContext({
        config: { apiKey: "test-key" },
        secrets: { "env://API_KEY": "resolved-key" },
      });

      expect(ctx.config.apiKey).toBe("test-key");
      expect(await ctx.resolveSecret("env://API_KEY")).toBe("resolved-key");
    });

    it("strips env:// prefix for convenience", async () => {
      const ctx = createTestContext({ secrets: { MY_SECRET: "val" } });
      expect(await ctx.resolveSecret("env://MY_SECRET")).toBe("val");
    });

    it("throws on missing secret", async () => {
      const ctx = createTestContext();
      await expect(ctx.resolveSecret("env://MISSING")).rejects.toThrow("Test secret not found");
    });
  });

  describe("buildTestEvent", () => {
    it("builds event with defaults", () => {
      const event = buildTestEvent();
      expect(event.id).toMatch(/^TEST-/);
      expect(event.version).toBe(1);
      expect(event.category).toBe("system");
      expect(event.outcome).toBe("success");
    });

    it("accepts overrides", () => {
      const event = buildTestEvent({
        action: "custom.action",
        category: "auth",
        outcome: "failure",
        tenantId: "t1",
      });
      expect(event.action).toBe("custom.action");
      expect(event.category).toBe("auth");
      expect(event.outcome).toBe("failure");
      expect(event.actor.tenantId).toBe("t1");
    });
  });

  describe("buildTestEvents", () => {
    it("builds N events", () => {
      const events = buildTestEvents(5, { category: "auth" });
      expect(events).toHaveLength(5);
      events.forEach((e) => expect(e.category).toBe("auth"));
    });
  });

  describe("createCollectorSink", () => {
    it("collects events", async () => {
      const sink = createCollectorSink();
      const event = buildTestEvent();

      await sink.send(event);
      expect(sink.events).toHaveLength(1);
      expect(sink.closed).toBe(false);

      await sink.close();
      expect(sink.closed).toBe(true);
    });
  });

  describe("createMemorySecretBackend", () => {
    it("supports CRUD operations", async () => {
      const backend = createMemorySecretBackend({ key1: "val1" });
      expect(backend.name).toBe("test-memory");

      expect(await backend.get("key1")).toBe("val1");
      expect(await backend.exists("key1")).toBe(true);
      expect(await backend.list()).toEqual(["key1"]);

      await backend.set("key2", "val2");
      expect(await backend.get("key2")).toBe("val2");

      await backend.delete("key1");
      expect(await backend.exists("key1")).toBe(false);

      await backend.shutdown();
    });
  });

  describe("guardrail helpers", () => {
    it("buildTestGuardrailContext creates context", () => {
      const ctx = buildTestGuardrailContext({ tool: "file_edit" });
      expect(ctx.tool).toBe("file_edit");
    });

    it("assertRuleAction validates rule", async () => {
      const rule: GuardrailRule = {
        id: "test-rule",
        description: "Test",
        evaluate: () => ({ action: "block", reason: "blocked" }),
      };
      await assertRuleAction(rule, buildTestGuardrailContext(), "block");
    });

    it("assertRuleAction handles null (no match)", async () => {
      const rule: GuardrailRule = {
        id: "test-rule",
        description: "Test",
        evaluate: () => null,
      };
      await assertRuleAction(rule, buildTestGuardrailContext(), null);
    });
  });

  describe("initTestPlugin", () => {
    it("initializes a plugin and returns exports", async () => {
      const plugin: PluginLifecycle = {
        manifest: {
          name: "test-plugin",
          version: "1.0.0",
          description: "Test plugin",
          capabilities: ["audit-sink"],
        },
        async init(ctx) {
          ctx.logger.info("initialized");
          return {
            auditSinks: [{ async send() {}, async close() {} }],
          };
        },
        async shutdown() {},
      };

      const result = await initTestPlugin(plugin, { config: { key: "val" } });
      expect(result.exports.auditSinks).toHaveLength(1);
      expect(result.ctx.logger.entries[0].msg).toBe("initialized");

      await result.shutdown();
    });
  });
});
