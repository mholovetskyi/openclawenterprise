/**
 * Plugin lifecycle — init/start/stop/healthCheck hooks.
 */

import type { AuditSink, GuardrailRule, HealthCheckResult, SecretBackend } from "./interfaces.js";
import type { PluginManifest } from "./plugin-manifest.js";

export type PluginContext = {
  /** Resolved plugin configuration (secrets already expanded) */
  config: Record<string, unknown>;
  /** Logger scoped to this plugin */
  logger: PluginLogger;
  /** Resolve a secret reference (e.g. env://FOO, vault://path) */
  resolveSecret: (ref: string) => Promise<string>;
};

export type PluginLogger = {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  debug(msg: string, data?: Record<string, unknown>): void;
};

export type PluginExports = {
  auditSinks?: AuditSink[];
  secretBackends?: SecretBackend[];
  guardrailRules?: GuardrailRule[];
};

export interface PluginLifecycle {
  /** Plugin manifest */
  manifest: PluginManifest;
  /** Initialize the plugin — called once after loading */
  init(ctx: PluginContext): Promise<PluginExports>;
  /** Graceful shutdown */
  shutdown?(): Promise<void>;
  /** Health check (optional) */
  healthCheck?(): Promise<HealthCheckResult>;
}
