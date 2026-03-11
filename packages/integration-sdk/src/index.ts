/**
 * @openclaw/integration-sdk
 *
 * Public SDK for building OpenClaw enterprise integrations.
 * Provides interfaces, base classes, and utilities for:
 *   - Audit sinks (with batching/retry via BaseBatchedAuditSink)
 *   - Secret backends
 *   - Guardrail rules
 *   - Plugin manifest and lifecycle
 */

// Interfaces & types
export type {
  AuditEvent,
  AuditEventCategory,
  AuditEventOutcome,
  AuditActor,
  AuditResource,
  AuditSink,
  SecretMetadata,
  SecretBackend,
  GuardrailAction,
  GuardrailContext,
  GuardrailResult,
  GuardrailRule,
  HealthStatus,
  HealthCheckResult,
  HealthCheckable,
} from "./interfaces.js";

// Plugin manifest
export type { PluginManifest, PluginCapability, ConfigFieldSchema } from "./plugin-manifest.js";

// Plugin lifecycle
export type { PluginContext, PluginLogger, PluginExports, PluginLifecycle } from "./lifecycle.js";

// Base classes
export { BaseBatchedAuditSink } from "./base-batched-audit-sink.js";
export type { BatchedAuditSinkOptions } from "./base-batched-audit-sink.js";
