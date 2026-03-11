import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildTestEvent,
  buildTestEvents,
  createTestContext,
  buildTestGuardrailContext,
} from "../../packages/integration-sdk/src/testing.js";
import plugin, { DatadogAuditSink, DatadogKeyProtectionRule } from "./index.js";

describe("datadog plugin", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("plugin lifecycle", () => {
    it("initializes with valid config", async () => {
      const ctx = createTestContext({
        config: {
          apiKey: "env://DD_API_KEY",
          site: "datadoghq.com",
          service: "openclaw",
          source: "openclaw-audit",
        },
        secrets: { DD_API_KEY: "test-api-key-123" },
      });

      const exports = await plugin.init(ctx);
      expect(exports.auditSinks).toHaveLength(1);
      expect(exports.guardrailRules).toHaveLength(1);
      expect(ctx.logger.entries.some((e) => e.msg.includes("site=datadoghq.com"))).toBe(true);

      await plugin.shutdown?.();
    });
  });

  describe("DatadogAuditSink", () => {
    it("sends events to Datadog Logs API", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response("", { status: 202 }));

      const { logger } = createTestContext();
      const sink = new DatadogAuditSink(logger, {
        apiKey: "test-key",
        site: "datadoghq.com",
        service: "openclaw",
        source: "openclaw-audit",
        batchSize: 2,
      });

      const events = buildTestEvents(2, { action: "agent.run.start", category: "agent" });
      for (const e of events) {
        await sink.send(e);
      }

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://http-intake.logs.datadoghq.com/api/v2/logs");
      expect((opts!.headers as Record<string, string>)["DD-API-KEY"]).toBe("test-key");

      const body = JSON.parse(opts?.body as string) as unknown[];
      expect(body).toHaveLength(2);

      await sink.close();
    });

    it("throws on non-OK response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Forbidden", { status: 403 }));

      const { logger } = createTestContext();
      const sink = new DatadogAuditSink(logger, {
        apiKey: "bad-key",
        site: "datadoghq.com",
        service: "openclaw",
        source: "openclaw-audit",
        batchSize: 1,
        retryAttempts: 0,
      });

      await sink.send(buildTestEvent());

      // Error should be logged (retries exhausted)
      expect(logger.entries.some((e) => e.level === "error")).toBe(true);
      await sink.close();
    });
  });

  describe("DatadogKeyProtectionRule", () => {
    const rule = new DatadogKeyProtectionRule();

    it("blocks commands accessing DD_API_KEY", () => {
      const ctx = buildTestGuardrailContext({ input: "echo $DD_API_KEY" });
      const result = rule.evaluate(ctx);
      expect(result).not.toBeNull();
      expect(result!.action).toBe("block");
    });

    it("blocks commands accessing DD_APP_KEY", () => {
      const ctx = buildTestGuardrailContext({ input: "env | grep DD_APP_KEY" });
      const result = rule.evaluate(ctx);
      expect(result).not.toBeNull();
      expect(result!.action).toBe("block");
    });

    it("allows normal commands", () => {
      const ctx = buildTestGuardrailContext({ input: "ls -la" });
      const result = rule.evaluate(ctx);
      expect(result).toBeNull();
    });

    it("skips non-bash tools", () => {
      const ctx = buildTestGuardrailContext({ tool: "file_edit", input: "DD_API_KEY" });
      const result = rule.evaluate(ctx);
      expect(result).toBeNull();
    });
  });

  describe("health check", () => {
    it("reports healthy when API validates", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));

      const ctx = createTestContext({
        config: { apiKey: "env://DD_API_KEY", site: "datadoghq.com" },
        secrets: { DD_API_KEY: "test-key" },
      });
      await plugin.init(ctx);

      const health = await plugin.healthCheck!();
      expect(health.status).toBe("healthy");

      await plugin.shutdown?.();
    });

    it("reports unhealthy when not initialized", async () => {
      await plugin.shutdown?.();
      const health = await plugin.healthCheck!();
      expect(health.status).toBe("unhealthy");
    });
  });
});
