import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildTestEvent,
  buildTestEvents,
  createTestContext,
} from "../../packages/integration-sdk/src/testing.js";
import plugin, { SplunkAuditSink } from "./index.js";

describe("splunk plugin", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("plugin lifecycle", () => {
    it("initializes with valid config", async () => {
      const ctx = createTestContext({
        config: {
          hecUrl: "https://splunk.internal:8088/services/collector/event",
          hecToken: "env://SPLUNK_HEC_TOKEN",
          index: "openclaw_audit",
        },
        secrets: { SPLUNK_HEC_TOKEN: "test-hec-token" },
      });

      const exports = await plugin.init(ctx);
      expect(exports.auditSinks).toHaveLength(1);
      expect(exports.guardrailRules).toBeUndefined();
      expect(exports.secretBackends).toBeUndefined();

      await plugin.shutdown?.();
    });
  });

  describe("SplunkAuditSink", () => {
    it("sends events to Splunk HEC", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response(JSON.stringify({ code: 0, text: "Success" }), { status: 200 }),
        );

      const { logger } = createTestContext();
      const sink = new SplunkAuditSink(logger, {
        hecUrl: "https://splunk.internal:8088/services/collector/event",
        hecToken: "test-token",
        index: "openclaw_audit",
        sourcetype: "openclaw:audit",
        batchSize: 3,
      });

      const events = buildTestEvents(3, { action: "auth.login.success", category: "auth" });
      for (const e of events) {
        await sink.send(e);
      }

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://splunk.internal:8088/services/collector/event");
      expect((opts!.headers as Record<string, string>)["Authorization"]).toBe("Splunk test-token");

      // Body should be newline-delimited JSON
      const body = opts?.body as string;
      const lines = body.split("\n");
      expect(lines).toHaveLength(3);

      // Each line should be a valid Splunk HEC event
      const parsed = JSON.parse(lines[0]);
      expect(parsed.sourcetype).toBe("openclaw:audit");
      expect(parsed.event.action).toBe("auth.login.success");

      await sink.close();
    });

    it("throws on HEC error code", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ code: 6, text: "Invalid data format" }), { status: 200 }),
      );

      const { logger } = createTestContext();
      const sink = new SplunkAuditSink(logger, {
        hecUrl: "https://splunk.internal:8088/services/collector/event",
        hecToken: "test-token",
        batchSize: 1,
        retryAttempts: 0,
      });

      await sink.send(buildTestEvent());
      expect(logger.entries.some((e) => e.level === "error")).toBe(true);

      await sink.close();
    });
  });

  describe("health check", () => {
    it("reports healthy when HEC is reachable", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));

      const ctx = createTestContext({
        config: {
          hecUrl: "https://splunk.internal:8088/services/collector/event",
          hecToken: "env://SPLUNK_TOKEN",
        },
        secrets: { SPLUNK_TOKEN: "test-token" },
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
