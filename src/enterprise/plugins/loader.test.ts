import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateSigningKeyPair,
  hashDirectory,
  type SkillSignature,
} from "../skills/registry/code-signing.js";
import { PluginLoader, PLUGIN_SIGNATURE_FILE } from "./loader.js";

function signPluginDir(
  dir: string,
  keyPair: { privateKey: string; publicKey: string },
): SkillSignature {
  const contentHash = hashDirectory(dir, { ignore: [PLUGIN_SIGNATURE_FILE] });
  const privateKeyObj = crypto.createPrivateKey({
    key: Buffer.from(keyPair.privateKey, "base64url"),
    format: "der",
    type: "pkcs8",
  });
  const signature = crypto
    .sign(null, Buffer.from(contentHash), privateKeyObj)
    .toString("base64url");
  const sig: SkillSignature = {
    algorithm: "ed25519",
    publicKey: keyPair.publicKey,
    signature,
    signedAt: new Date().toISOString(),
    contentHash,
  };
  fs.writeFileSync(path.join(dir, PLUGIN_SIGNATURE_FILE), JSON.stringify(sig));
  return sig;
}

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

  describe("signature enforcement (requireSigning)", () => {
    it("refuses to load (and does not import) an unsigned plugin when signing is required", async () => {
      const pluginDir = path.join(tmpDir, "unsigned");
      fs.mkdirSync(pluginDir);
      const plugin = makeTestPlugin({ name: "unsigned" });
      const modulePath = path.join(pluginDir, "index.js");
      fs.writeFileSync(modulePath, "");
      vi.doMock(modulePath, () => plugin);

      const keyPair = generateSigningKeyPair();
      loader = new PluginLoader({
        requireSigning: true,
        trustedPublicKeys: [keyPair.publicKey],
      });
      const result = await loader.loadFromPath(modulePath, pluginDir);
      expect(result).toBeNull();
      // The plugin's init must never run — code was not imported/executed.
      expect(plugin.default.init).not.toHaveBeenCalled();
      expect(loader.size).toBe(0);
    });

    it("fails closed when signing is required but no trusted keys are configured", async () => {
      const pluginDir = path.join(tmpDir, "signed-no-anchor");
      fs.mkdirSync(pluginDir);
      const plugin = makeTestPlugin({ name: "signed-no-anchor" });
      const modulePath = path.join(pluginDir, "index.js");
      fs.writeFileSync(modulePath, "");
      const keyPair = generateSigningKeyPair();
      signPluginDir(pluginDir, keyPair);
      vi.doMock(modulePath, () => plugin);

      // requireSigning on, but trustedPublicKeys omitted → no trust anchor.
      loader = new PluginLoader({ requireSigning: true });
      const result = await loader.loadFromPath(modulePath, pluginDir);
      expect(result).toBeNull();
      expect(plugin.default.init).not.toHaveBeenCalled();
    });

    it("rejects a plugin signed by an untrusted key", async () => {
      const pluginDir = path.join(tmpDir, "untrusted-signer");
      fs.mkdirSync(pluginDir);
      const plugin = makeTestPlugin({ name: "untrusted-signer" });
      const modulePath = path.join(pluginDir, "index.js");
      fs.writeFileSync(modulePath, "");
      const attacker = generateSigningKeyPair();
      const trusted = generateSigningKeyPair();
      signPluginDir(pluginDir, attacker);
      vi.doMock(modulePath, () => plugin);

      loader = new PluginLoader({
        requireSigning: true,
        trustedPublicKeys: [trusted.publicKey],
      });
      const result = await loader.loadFromPath(modulePath, pluginDir);
      expect(result).toBeNull();
      expect(plugin.default.init).not.toHaveBeenCalled();
    });

    it("rejects a plugin whose contents were tampered after signing", async () => {
      const pluginDir = path.join(tmpDir, "tampered");
      fs.mkdirSync(pluginDir);
      const plugin = makeTestPlugin({ name: "tampered" });
      const modulePath = path.join(pluginDir, "index.js");
      fs.writeFileSync(modulePath, "");
      const keyPair = generateSigningKeyPair();
      signPluginDir(pluginDir, keyPair);
      // Tamper after signing.
      fs.writeFileSync(path.join(pluginDir, "evil.js"), "// injected");
      vi.doMock(modulePath, () => plugin);

      loader = new PluginLoader({
        requireSigning: true,
        trustedPublicKeys: [keyPair.publicKey],
      });
      const result = await loader.loadFromPath(modulePath, pluginDir);
      expect(result).toBeNull();
      expect(plugin.default.init).not.toHaveBeenCalled();
    });

    it("loads a plugin signed by a trusted key", async () => {
      const pluginDir = path.join(tmpDir, "trusted");
      fs.mkdirSync(pluginDir);
      const plugin = makeTestPlugin({ name: "trusted" });
      const modulePath = path.join(pluginDir, "index.js");
      fs.writeFileSync(modulePath, "");
      const keyPair = generateSigningKeyPair();
      signPluginDir(pluginDir, keyPair);
      vi.doMock(modulePath, () => plugin);

      loader = new PluginLoader({
        requireSigning: true,
        trustedPublicKeys: [keyPair.publicKey],
      });
      const result = await loader.loadFromPath(modulePath, pluginDir);
      expect(result).not.toBeNull();
      expect(result!.manifest.name).toBe("trusted");
      expect(plugin.default.init).toHaveBeenCalled();
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
