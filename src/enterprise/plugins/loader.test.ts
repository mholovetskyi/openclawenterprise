import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PluginLoader } from "./loader.js";

// ── Test plugin factory ──────────────────────────────────────────────────────

function makeTestPlugin(overrides: Record<string, unknown> = {}) {
  const shutdownFn = vi.fn();
  const healthFn = vi.fn().mockResolvedValue({ status: "healthy" });
  const sinkCloseFn = vi.fn();

  return {
    default: {
      manifest: {
        name: overrides.name ?? "test-plugin",
        version: overrides.version ?? "1.0.0",
        description: overrides.description ?? "A test plugin",
        capabilities: overrides.capabilities ?? ["audit-sink"],
        configSchema: overrides.configSchema,
      },
      init: vi.fn().mockResolvedValue({
        auditSinks: [{ send: vi.fn(), close: sinkCloseFn }],
        ...(overrides.exports as Record<string, unknown>),
      }),
      shutdown: shutdownFn,
      healthCheck: healthFn,
    },
    shutdownFn,
    healthFn,
    sinkCloseFn,
  };
}

describe("PluginLoader", () => {
  let tmpDir: string;
  let loader: PluginLoader;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync("/tmp/plugin-loader-test-");
    loader = new PluginLoader();
  });

  afterEach(async () => {
    await loader.shutdownAll();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("config validation", () => {
    it("rejects missing required config keys", async () => {
      const pluginDir = path.join(tmpDir, "my-plugin");
      fs.mkdirSync(pluginDir);

      const plugin = makeTestPlugin({
        configSchema: {
          apiKey: { type: "string", required: true },
        },
      });

      // Mock dynamic import
      const modulePath = path.join(pluginDir, "index.js");
      fs.writeFileSync(modulePath, ""); // placeholder
      vi.doMock(modulePath, () => plugin);

      loader = new PluginLoader({ pluginConfig: {} });
      const result = await loader.loadFromPath(modulePath, pluginDir);
      expect(result).toBeNull(); // Should fail config validation
    });

    it("applies default values from schema", async () => {
      const pluginDir = path.join(tmpDir, "my-plugin");
      fs.mkdirSync(pluginDir);

      const plugin = makeTestPlugin({
        configSchema: {
          batchSize: { type: "number", default: 50 },
        },
      });

      const modulePath = path.join(pluginDir, "index.js");
      fs.writeFileSync(modulePath, "");
      vi.doMock(modulePath, () => plugin);

      loader = new PluginLoader({
        pluginConfig: { "test-plugin": {} },
      });
      const result = await loader.loadFromPath(modulePath, pluginDir);
      expect(result).not.toBeNull();

      // Check that init was called with the default applied
      const initCall = plugin.default.init.mock.calls[0]![0];
      expect(initCall.config.batchSize).toBe(50);
    });
  });

  describe("plugin management", () => {
    it("loads, retrieves, and lists plugins", async () => {
      const pluginDir = path.join(tmpDir, "my-plugin");
      fs.mkdirSync(pluginDir);

      const plugin = makeTestPlugin();
      const modulePath = path.join(pluginDir, "index.js");
      fs.writeFileSync(modulePath, "");
      vi.doMock(modulePath, () => plugin);

      const result = await loader.loadFromPath(modulePath, pluginDir);
      expect(result).not.toBeNull();
      expect(result!.manifest.name).toBe("test-plugin");
      expect(loader.size).toBe(1);
      expect(loader.get("test-plugin")).toBeDefined();
      expect(loader.getAll()).toHaveLength(1);
    });

    it("prevents duplicate loading", async () => {
      const pluginDir = path.join(tmpDir, "my-plugin");
      fs.mkdirSync(pluginDir);

      const plugin = makeTestPlugin();
      const modulePath = path.join(pluginDir, "index.js");
      fs.writeFileSync(modulePath, "");
      vi.doMock(modulePath, () => plugin);

      await loader.loadFromPath(modulePath, pluginDir);
      const dup = await loader.loadFromPath(modulePath, pluginDir);
      expect(dup).toBeNull();
      expect(loader.size).toBe(1);
    });

    it("skips disabled plugins", async () => {
      const pluginDir = path.join(tmpDir, "my-plugin");
      fs.mkdirSync(pluginDir);

      const plugin = makeTestPlugin();
      const modulePath = path.join(pluginDir, "index.js");
      fs.writeFileSync(modulePath, "");
      vi.doMock(modulePath, () => plugin);

      loader = new PluginLoader({ disabled: ["test-plugin"] });
      const result = await loader.loadFromPath(modulePath, pluginDir);
      expect(result).toBeNull();
    });
  });

  describe("aggregate accessors", () => {
    it("collects audit sinks from all plugins", async () => {
      const pluginDir = path.join(tmpDir, "p1");
      fs.mkdirSync(pluginDir);
      const plugin = makeTestPlugin({ name: "p1" });
      const modulePath = path.join(pluginDir, "index.js");
      fs.writeFileSync(modulePath, "");
      vi.doMock(modulePath, () => plugin);

      await loader.loadFromPath(modulePath, pluginDir);
      expect(loader.getAllAuditSinks()).toHaveLength(1);
      expect(loader.getAllSecretBackends()).toHaveLength(0);
      expect(loader.getAllGuardrailRules()).toHaveLength(0);
    });
  });

  describe("health checks", () => {
    it("runs health checks on all plugins", async () => {
      const pluginDir = path.join(tmpDir, "p1");
      fs.mkdirSync(pluginDir);
      const plugin = makeTestPlugin({ name: "p1" });
      const modulePath = path.join(pluginDir, "index.js");
      fs.writeFileSync(modulePath, "");
      vi.doMock(modulePath, () => plugin);

      await loader.loadFromPath(modulePath, pluginDir);
      const health = await loader.healthCheck();
      expect(health.p1?.status).toBe("healthy");
    });

    it("catches health check failures", async () => {
      const pluginDir = path.join(tmpDir, "p1");
      fs.mkdirSync(pluginDir);
      const plugin = makeTestPlugin({ name: "p1" });
      plugin.healthFn.mockRejectedValue(new Error("connection failed"));
      const modulePath = path.join(pluginDir, "index.js");
      fs.writeFileSync(modulePath, "");
      vi.doMock(modulePath, () => plugin);

      await loader.loadFromPath(modulePath, pluginDir);
      const health = await loader.healthCheck();
      expect(health.p1?.status).toBe("unhealthy");
      expect(health.p1?.message).toContain("connection failed");
    });
  });

  describe("shutdown", () => {
    it("shuts down all plugins", async () => {
      const pluginDir = path.join(tmpDir, "p1");
      fs.mkdirSync(pluginDir);
      const plugin = makeTestPlugin({ name: "p1" });
      const modulePath = path.join(pluginDir, "index.js");
      fs.writeFileSync(modulePath, "");
      vi.doMock(modulePath, () => plugin);

      await loader.loadFromPath(modulePath, pluginDir);
      expect(loader.size).toBe(1);

      await loader.shutdownAll();
      expect(loader.size).toBe(0);
      expect(plugin.shutdownFn).toHaveBeenCalled();
      expect(plugin.sinkCloseFn).toHaveBeenCalled();
    });
  });
});
