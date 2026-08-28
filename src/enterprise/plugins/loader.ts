/**
 * Plugin Loader — runtime discovery, loading, validation, and lifecycle
 * management for OpenClaw enterprise integration plugins.
 *
 * Plugins are loaded from:
 *   1. Built-in plugin directories (plugins/)
 *   2. Configured plugin paths (enterprise.plugins.paths[])
 *   3. npm packages (@openclaw/plugin-*)
 *
 * Each plugin must export a default PluginLifecycle object.
 */

import fs from "node:fs";
import path from "node:path";
import { verifySkillSignature, type SkillSignature } from "../skills/registry/code-signing.js";

// Use inline types to avoid cross-package import issues at runtime.
// These match the @openclaw/integration-sdk interfaces exactly.

type PluginCapability = "audit-sink" | "secret-backend" | "guardrail-rule";

type ConfigFieldSchema = {
  type: "string" | "number" | "boolean";
  required?: boolean;
  default?: string | number | boolean;
  description?: string;
  secret?: boolean;
};

type PluginManifest = {
  name: string;
  version: string;
  description: string;
  author?: string;
  minOpenClawVersion?: string;
  capabilities: PluginCapability[];
  configSchema?: Record<string, ConfigFieldSchema>;
};

type HealthCheckResult = {
  status: "healthy" | "degraded" | "unhealthy";
  message?: string;
  details?: Record<string, unknown>;
  latencyMs?: number;
};

type PluginLogger = {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  debug(msg: string, data?: Record<string, unknown>): void;
};

type PluginContext = {
  config: Record<string, unknown>;
  logger: PluginLogger;
  resolveSecret: (ref: string) => Promise<string>;
};

type AuditSink = {
  send(event: unknown): Promise<void>;
  close(): Promise<void>;
};

type SecretBackendLike = {
  readonly name: string;
  shutdown(): Promise<void>;
};

type GuardrailRuleLike = {
  readonly id: string;
  readonly description: string;
};

type PluginExports = {
  auditSinks?: AuditSink[];
  secretBackends?: SecretBackendLike[];
  guardrailRules?: GuardrailRuleLike[];
};

type PluginLifecycle = {
  manifest: PluginManifest;
  init(ctx: PluginContext): Promise<PluginExports>;
  shutdown?(): Promise<void>;
  healthCheck?(): Promise<HealthCheckResult>;
};

// ── Loaded plugin record ─────────────────────────────────────────────────────

export type LoadedPlugin = {
  manifest: PluginManifest;
  exports: PluginExports;
  lifecycle: PluginLifecycle;
  source: string;
  loadedAt: string;
};

// ── Plugin loader config ─────────────────────────────────────────────────────

export type PluginLoaderConfig = {
  /** Additional directories to scan for plugins */
  paths?: string[];
  /** Plugin-specific config keyed by plugin name */
  pluginConfig?: Record<string, Record<string, unknown>>;
  /** Secret resolver function */
  resolveSecret?: (ref: string) => Promise<string>;
  /** Disabled plugin names */
  disabled?: string[];
  /**
   * Require a valid Ed25519 signature over the plugin directory before the
   * plugin's code is dynamically imported. When true, an unsigned plugin, a
   * plugin with an invalid/tampered signature, or a plugin whose publisher key
   * is not in `trustedPublicKeys` is rejected (fail closed) instead of executed.
   */
  requireSigning?: boolean;
  /** Base64url-encoded Ed25519 publisher public keys trusted to sign plugins. */
  trustedPublicKeys?: string[];
};

/**
 * Filename of the detached plugin signature sidecar, placed at the root of the
 * plugin directory. It is excluded from the signed content hash.
 */
export const PLUGIN_SIGNATURE_FILE = "plugin.sig.json";

// ── Logger factory ───────────────────────────────────────────────────────────

function createPluginLogger(pluginName: string): PluginLogger {
  const prefix = `[plugin:${pluginName}]`;
  return {
    info(msg, data) {
      process.stderr.write(`${prefix} ${msg}${data ? " " + JSON.stringify(data) : ""}\n`);
    },
    warn(msg, data) {
      process.stderr.write(`${prefix} WARN: ${msg}${data ? " " + JSON.stringify(data) : ""}\n`);
    },
    error(msg, data) {
      process.stderr.write(`${prefix} ERROR: ${msg}${data ? " " + JSON.stringify(data) : ""}\n`);
    },
    debug(msg, data) {
      if (process.env.OPENCLAW_PLUGIN_DEBUG) {
        process.stderr.write(`${prefix} DEBUG: ${msg}${data ? " " + JSON.stringify(data) : ""}\n`);
      }
    },
  };
}

// ── Config validation ────────────────────────────────────────────────────────

function validateConfig(manifest: PluginManifest, config: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const schema = manifest.configSchema;
  if (!schema) {
    return errors;
  }

  for (const [key, field] of Object.entries(schema)) {
    const value = config[key];
    if (field.required && value === undefined && field.default === undefined) {
      errors.push(`Missing required config key: ${key}`);
      continue;
    }
    if (value !== undefined) {
      const actualType = typeof value;
      if (actualType !== field.type) {
        errors.push(`Config key "${key}": expected ${field.type}, got ${actualType}`);
      }
    }
  }
  return errors;
}

/** Apply defaults from config schema */
function applyDefaults(
  manifest: PluginManifest,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...config };
  const schema = manifest.configSchema;
  if (!schema) {
    return result;
  }

  for (const [key, field] of Object.entries(schema)) {
    if (result[key] === undefined && field.default !== undefined) {
      result[key] = field.default;
    }
  }
  return result;
}

// ── Manifest validation ──────────────────────────────────────────────────────

function validateManifest(manifest: unknown): manifest is PluginManifest {
  if (!manifest || typeof manifest !== "object") {
    return false;
  }
  // SAFETY: manifest is a non-null object here (guarded above); reading its properties as unknown-typed record entries is always sound, and each is typeof-checked below.
  const m = manifest as Record<string, unknown>;
  return (
    typeof m.name === "string" &&
    typeof m.version === "string" &&
    typeof m.description === "string" &&
    Array.isArray(m.capabilities) &&
    m.capabilities.length > 0
  );
}

// ── Signature shape validation ───────────────────────────────────────────────

function isSkillSignature(value: unknown): value is SkillSignature {
  if (!value || typeof value !== "object") {
    return false;
  }
  // SAFETY: value is a non-null object here (guarded above); reading its properties as unknown-typed record entries is always sound, and each is typeof-checked below.
  const s = value as Record<string, unknown>;
  return (
    s.algorithm === "ed25519" &&
    typeof s.publicKey === "string" &&
    typeof s.signature === "string" &&
    typeof s.contentHash === "string" &&
    typeof s.signedAt === "string"
  );
}

// ── Plugin Loader ────────────────────────────────────────────────────────────

export class PluginLoader {
  private plugins = new Map<string, LoadedPlugin>();
  private config: PluginLoaderConfig;

  constructor(config: PluginLoaderConfig = {}) {
    this.config = config;
  }

  /** Discover and load all plugins from configured paths */
  async discoverAndLoad(): Promise<LoadedPlugin[]> {
    const searchPaths = [
      path.resolve("plugins"),
      ...(this.config.paths ?? []).map((p) => path.resolve(p)),
    ];

    const loaded: LoadedPlugin[] = [];

    for (const searchPath of searchPaths) {
      if (!fs.existsSync(searchPath)) {
        continue;
      }

      const entries = fs.readdirSync(searchPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        const pluginDir = path.join(searchPath, entry.name);
        try {
          const plugin = await this.loadFromDirectory(pluginDir);
          if (plugin) {
            loaded.push(plugin);
          }
        } catch (err) {
          process.stderr.write(
            `[plugin-loader] Failed to load plugin from ${pluginDir}: ${String(err)}\n`,
          );
        }
      }
    }

    return loaded;
  }

  /** Load a single plugin from a directory */
  async loadFromDirectory(dir: string): Promise<LoadedPlugin | null> {
    // Try to find the entry point
    const candidates = ["index.ts", "index.js", "index.mjs"];
    let entryPoint: string | null = null;

    for (const c of candidates) {
      const p = path.join(dir, c);
      if (fs.existsSync(p)) {
        entryPoint = p;
        break;
      }
    }

    // Also check package.json main
    const pkgPath = path.join(dir, "package.json");
    if (!entryPoint && fs.existsSync(pkgPath)) {
      try {
        // SAFETY: a package.json root is a JSON object per the npm manifest format; a non-object parse or read error is swallowed by the surrounding try/catch, and the `typeof pkg.main === "string"` guard keeps a malformed shape harmless.
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
        if (typeof pkg.main === "string") {
          const mainPath = path.join(dir, pkg.main);
          if (fs.existsSync(mainPath)) {
            entryPoint = mainPath;
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (!entryPoint) {
      process.stderr.write(`[plugin-loader] No entry point found in ${dir}\n`);
      return null;
    }

    return this.loadFromPath(entryPoint, dir);
  }

  /**
   * Verify the integrity of a plugin directory against a detached Ed25519
   * signature before its code is imported. Fails closed: any missing/malformed
   * signature, hash mismatch, or untrusted publisher key returns an error.
   */
  private verifyIntegrity(source: string): { valid: boolean; reason?: string } {
    const sigPath = path.join(source, PLUGIN_SIGNATURE_FILE);
    if (!fs.existsSync(sigPath)) {
      return { valid: false, reason: `missing plugin signature (${PLUGIN_SIGNATURE_FILE})` };
    }

    let signature: SkillSignature;
    try {
      const parsed = JSON.parse(fs.readFileSync(sigPath, "utf8")) as unknown;
      if (!isSkillSignature(parsed)) {
        return { valid: false, reason: "malformed plugin signature" };
      }
      signature = parsed;
    } catch (err) {
      return { valid: false, reason: `unreadable plugin signature: ${String(err)}` };
    }

    // verifySkillSignature fails closed on an empty/absent trusted-key list, so
    // requireSigning with no configured keys correctly rejects every plugin.
    return verifySkillSignature({
      skillDir: source,
      signature,
      trustedPublicKeys: this.config.trustedPublicKeys,
      ignoreFiles: [PLUGIN_SIGNATURE_FILE],
    });
  }

  /** Load a plugin from a specific file path */
  async loadFromPath(entryPoint: string, source: string): Promise<LoadedPlugin | null> {
    // Integrity gate: verify the plugin BEFORE importing (and thus executing)
    // any of its code. Skipped only when signing enforcement is off.
    if (this.config.requireSigning) {
      const integrity = this.verifyIntegrity(source);
      if (!integrity.valid) {
        process.stderr.write(
          `[plugin-loader] Refusing to load plugin at ${entryPoint}: ${integrity.reason}\n`,
        );
        return null;
      }
    }

    // SAFETY: a dynamic import resolves to an ES module namespace object whose `default` is the plugin's default export when present; it is validated by validateManifest below before any field is trusted, so an unexpected shape fails closed.
    const mod = (await import(entryPoint)) as { default?: PluginLifecycle };
    const lifecycle = mod.default;

    if (!lifecycle || !validateManifest(lifecycle.manifest)) {
      process.stderr.write(
        `[plugin-loader] Invalid plugin at ${entryPoint}: missing or invalid manifest\n`,
      );
      return null;
    }

    const manifest = lifecycle.manifest;

    // Check if disabled
    if (this.config.disabled?.includes(manifest.name)) {
      process.stderr.write(`[plugin-loader] Plugin "${manifest.name}" is disabled, skipping\n`);
      return null;
    }

    // Check for duplicates
    if (this.plugins.has(manifest.name)) {
      process.stderr.write(
        `[plugin-loader] Plugin "${manifest.name}" already loaded, skipping duplicate\n`,
      );
      return null;
    }

    // Get plugin config and apply defaults
    const rawConfig = this.config.pluginConfig?.[manifest.name] ?? {};
    const config = applyDefaults(manifest, rawConfig);

    // Validate config
    const configErrors = validateConfig(manifest, config);
    if (configErrors.length > 0) {
      process.stderr.write(
        `[plugin-loader] Plugin "${manifest.name}" config errors:\n` +
          configErrors.map((e) => `  - ${e}`).join("\n") +
          "\n",
      );
      return null;
    }

    // Create context
    const logger = createPluginLogger(manifest.name);
    const ctx: PluginContext = {
      config,
      logger,
      resolveSecret: this.config.resolveSecret ?? (async (ref) => ref),
    };

    // Initialize
    logger.info(`Loading plugin v${manifest.version} (${manifest.capabilities.join(", ")})`);
    const exports = await lifecycle.init(ctx);

    const loaded: LoadedPlugin = {
      manifest,
      exports,
      lifecycle,
      source,
      loadedAt: new Date().toISOString(),
    };

    this.plugins.set(manifest.name, loaded);
    logger.info("Plugin loaded successfully");
    return loaded;
  }

  /** Get a loaded plugin by name */
  get(name: string): LoadedPlugin | undefined {
    return this.plugins.get(name);
  }

  /** Get all loaded plugins */
  getAll(): LoadedPlugin[] {
    return [...this.plugins.values()];
  }

  /** Get all audit sinks from all loaded plugins */
  getAllAuditSinks(): AuditSink[] {
    return this.getAll().flatMap((p) => p.exports.auditSinks ?? []);
  }

  /** Get all secret backends from all loaded plugins */
  getAllSecretBackends(): SecretBackendLike[] {
    return this.getAll().flatMap((p) => p.exports.secretBackends ?? []);
  }

  /** Get all guardrail rules from all loaded plugins */
  getAllGuardrailRules(): GuardrailRuleLike[] {
    return this.getAll().flatMap((p) => p.exports.guardrailRules ?? []);
  }

  /** Run health checks on all plugins */
  async healthCheck(): Promise<Record<string, HealthCheckResult>> {
    const results: Record<string, HealthCheckResult> = {};
    for (const [name, plugin] of this.plugins) {
      if (plugin.lifecycle.healthCheck) {
        try {
          const start = Date.now();
          const result = await plugin.lifecycle.healthCheck();
          result.latencyMs = Date.now() - start;
          results[name] = result;
        } catch (err) {
          results[name] = {
            status: "unhealthy",
            message: err instanceof Error ? err.message : String(err),
          };
        }
      } else {
        results[name] = { status: "healthy", message: "No health check defined" };
      }
    }
    return results;
  }

  /** Shutdown all plugins gracefully */
  async shutdownAll(): Promise<void> {
    const shutdownPromises = [...this.plugins.entries()].map(async ([name, plugin]) => {
      try {
        // Close audit sinks
        if (plugin.exports.auditSinks) {
          await Promise.all(plugin.exports.auditSinks.map((s) => s.close()));
        }
        // Shutdown secret backends
        if (plugin.exports.secretBackends) {
          await Promise.all(plugin.exports.secretBackends.map((b) => b.shutdown()));
        }
        // Shutdown plugin lifecycle
        await plugin.lifecycle.shutdown?.();
      } catch (err) {
        process.stderr.write(`[plugin-loader] Error shutting down "${name}": ${String(err)}\n`);
      }
    });
    await Promise.all(shutdownPromises);
    this.plugins.clear();
  }

  /** Number of loaded plugins */
  get size(): number {
    return this.plugins.size;
  }
}
