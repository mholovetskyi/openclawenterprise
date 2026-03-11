/**
 * Core interfaces for the OpenClaw Enterprise Integration SDK.
 *
 * Three extension points:
 *   1. AuditSink — receive and forward audit events
 *   2. SecretBackend — pluggable secret storage
 *   3. GuardrailRule — custom guardrail logic
 */

// ── Audit Event types (mirrored from core for SDK consumers) ────────────────

export type AuditEventCategory =
  | "auth"
  | "agent"
  | "skill"
  | "config"
  | "admin"
  | "data"
  | "system"
  | "security";

export type AuditEventOutcome = "success" | "failure" | "denied";

export type AuditActor = {
  type: "user" | "agent" | "system" | "api-key" | "anonymous";
  id: string;
  name?: string;
  email?: string;
  ip?: string;
  channel?: string;
  channelUserId?: string;
  tenantId?: string;
  sessionId?: string;
};

export type AuditResource = {
  type: string;
  id: string;
  name?: string;
};

export type AuditEvent = {
  id: string;
  timestamp: string;
  version: 1;
  actor: AuditActor;
  action: string;
  category: AuditEventCategory;
  resource?: AuditResource;
  outcome: AuditEventOutcome;
  durationMs?: number;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  previousHash?: string;
  hash: string;
};

// ── AuditSink ────────────────────────────────────────────────────────────────

export interface AuditSink {
  /** Send a single audit event. Implementations may buffer internally. */
  send(event: AuditEvent): Promise<void>;
  /** Flush any buffered events and release resources. */
  close(): Promise<void>;
}

// ── SecretBackend ─────────────────────────────────────────────────────────────

export type SecretMetadata = {
  description?: string;
  tags?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
};

export interface SecretBackend {
  readonly name: string;
  get(ref: string): Promise<string | null>;
  set(ref: string, value: string, meta?: SecretMetadata): Promise<void>;
  delete(ref: string): Promise<void>;
  list(): Promise<string[]>;
  exists(ref: string): Promise<boolean>;
  shutdown(): Promise<void>;
}

// ── GuardrailRule ─────────────────────────────────────────────────────────────

export type GuardrailAction = "allow" | "warn" | "block" | "require-approval";

export type GuardrailContext = {
  tool: string;
  input?: unknown;
  output?: string;
  agentId?: string;
  sessionKey?: string;
  tenantId?: string;
};

export type GuardrailResult = {
  action: GuardrailAction;
  reason: string;
};

export interface GuardrailRule {
  readonly id: string;
  readonly description: string;
  /** Evaluate the rule against a context. Return null to skip (no match). */
  evaluate(ctx: GuardrailContext): GuardrailResult | null | Promise<GuardrailResult | null>;
}

// ── Health check ─────────────────────────────────────────────────────────────

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export type HealthCheckResult = {
  status: HealthStatus;
  message?: string;
  details?: Record<string, unknown>;
  latencyMs?: number;
};

export interface HealthCheckable {
  healthCheck(): Promise<HealthCheckResult>;
}
