/**
 * PluginTestHarness — testing utilities for plugin authors.
 *
 * Provides fake context, event builders, and assertion helpers
 * to simplify testing plugins without running OpenClaw.
 */

import type {
  AuditEvent,
  AuditEventCategory,
  AuditEventOutcome,
  AuditSink,
  GuardrailAction,
  GuardrailContext,
  GuardrailRule,
  SecretBackend,
} from "./interfaces.js";
import type { PluginContext, PluginExports, PluginLifecycle, PluginLogger } from "./lifecycle.js";

// ── Fake logger ──────────────────────────────────────────────────────────────

export type LogEntry = {
  level: "info" | "warn" | "error" | "debug";
  msg: string;
  data?: Record<string, unknown>;
};

export function createTestLogger(): PluginLogger & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return {
    entries,
    info(msg, data) {
      entries.push({ level: "info", msg, data });
    },
    warn(msg, data) {
      entries.push({ level: "warn", msg, data });
    },
    error(msg, data) {
      entries.push({ level: "error", msg, data });
    },
    debug(msg, data) {
      entries.push({ level: "debug", msg, data });
    },
  };
}

// ── Fake context ─────────────────────────────────────────────────────────────

export type TestContextOptions = {
  config?: Record<string, unknown>;
  secrets?: Record<string, string>;
};

export function createTestContext(
  opts: TestContextOptions = {},
): PluginContext & { logger: PluginLogger & { entries: LogEntry[] } } {
  const logger = createTestLogger();
  const secrets = opts.secrets ?? {};
  return {
    config: opts.config ?? {},
    logger,
    resolveSecret: async (ref: string) => {
      const direct = secrets[ref];
      if (direct !== undefined) {
        return direct;
      }
      // Strip env:// prefix for test convenience
      const stripped = ref.replace(/^env:\/\//, "");
      const viaStripped = secrets[stripped];
      if (viaStripped !== undefined) {
        return viaStripped;
      }
      throw new Error(`Test secret not found: ${ref}`);
    },
  };
}

// ── Audit event builder ──────────────────────────────────────────────────────

let eventCounter = 0;

export type TestEventOptions = {
  action?: string;
  category?: AuditEventCategory;
  outcome?: AuditEventOutcome;
  actorId?: string;
  actorType?: "user" | "agent" | "system" | "api-key" | "anonymous";
  tenantId?: string;
  resourceType?: string;
  resourceId?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
};

export function buildTestEvent(opts: TestEventOptions = {}): AuditEvent {
  const idx = ++eventCounter;
  return {
    id: `TEST-${String(idx).padStart(6, "0")}`,
    timestamp: new Date().toISOString(),
    version: 1,
    actor: {
      type: opts.actorType ?? "user",
      id: opts.actorId ?? `test-user-${idx}`,
      tenantId: opts.tenantId,
    },
    action: opts.action ?? "test.action",
    category: opts.category ?? "system",
    outcome: opts.outcome ?? "success",
    resource: opts.resourceType
      ? { type: opts.resourceType, id: opts.resourceId ?? `res-${idx}` }
      : undefined,
    durationMs: opts.durationMs,
    metadata: opts.metadata,
    hash: `testhash${idx}`,
  };
}

/**
 * Build N test events at once.
 */
export function buildTestEvents(count: number, opts: TestEventOptions = {}): AuditEvent[] {
  return Array.from({ length: count }, () => buildTestEvent(opts));
}

// ── Sink collector ───────────────────────────────────────────────────────────

/**
 * A test audit sink that collects all events for assertion.
 */
export function createCollectorSink(): AuditSink & { events: AuditEvent[]; closed: boolean } {
  const events: AuditEvent[] = [];
  let closed = false;
  return {
    events,
    get closed() {
      return closed;
    },
    async send(event: AuditEvent) {
      events.push(event);
    },
    async close() {
      closed = true;
    },
  };
}

// ── In-memory secret backend ─────────────────────────────────────────────────

export function createMemorySecretBackend(initial: Record<string, string> = {}): SecretBackend {
  const store = new Map(Object.entries(initial));
  return {
    name: "test-memory",
    async get(ref) {
      return store.get(ref) ?? null;
    },
    async set(ref, value) {
      store.set(ref, value);
    },
    async delete(ref) {
      store.delete(ref);
    },
    async list() {
      return [...store.keys()];
    },
    async exists(ref) {
      return store.has(ref);
    },
    async shutdown() {
      store.clear();
    },
  };
}

// ── Guardrail test helpers ───────────────────────────────────────────────────

export function buildTestGuardrailContext(
  overrides: Partial<GuardrailContext> = {},
): GuardrailContext {
  return {
    tool: "bash",
    input: "echo hello",
    ...overrides,
  };
}

/**
 * Evaluate a guardrail rule and assert the expected action.
 */
export async function assertRuleAction(
  rule: GuardrailRule,
  ctx: GuardrailContext,
  expectedAction: GuardrailAction | null,
): Promise<void> {
  const result = await rule.evaluate(ctx);
  const actual = result?.action ?? null;
  if (actual !== expectedAction) {
    throw new Error(`Rule "${rule.id}": expected action "${expectedAction}", got "${actual}"`);
  }
}

// ── Plugin test harness ──────────────────────────────────────────────────────

export type PluginTestHarnessResult = {
  exports: PluginExports;
  ctx: PluginContext & { logger: PluginLogger & { entries: LogEntry[] } };
  shutdown: () => Promise<void>;
};

/**
 * Initialize a plugin in a test environment and return its exports.
 */
export async function initTestPlugin(
  plugin: PluginLifecycle,
  opts: TestContextOptions = {},
): Promise<PluginTestHarnessResult> {
  const ctx = createTestContext(opts);
  const exports = await plugin.init(ctx);
  return {
    exports,
    ctx,
    shutdown: async () => {
      // Close all sinks
      if (exports.auditSinks) {
        await Promise.all(exports.auditSinks.map((s) => s.close()));
      }
      // Shutdown all backends
      if (exports.secretBackends) {
        await Promise.all(exports.secretBackends.map((b) => b.shutdown()));
      }
      // Shutdown plugin
      await plugin.shutdown?.();
    },
  };
}
