/**
 * Datadog integration plugin — audit sink + guardrail rule + health check.
 *
 * Sends audit events to Datadog Logs API and exposes Datadog-based
 * guardrail rules for content moderation.
 *
 * Config:
 *   enterprise.plugins.pluginConfig.datadog:
 *     apiKey: env://DD_API_KEY
 *     site: datadoghq.com          # or datadoghq.eu, us3.datadoghq.com, etc.
 *     service: openclaw
 *     source: openclaw-audit
 *     batchSize: 100
 *     flushIntervalMs: 5000
 *     tags: "env:prod,team:platform"
 */

import type {
  AuditEvent,
  GuardrailContext,
  GuardrailResult,
  GuardrailRule,
  HealthCheckResult,
  PluginContext,
  PluginExports,
  PluginLifecycle,
  PluginLogger,
  BatchedAuditSinkOptions,
} from "../../packages/integration-sdk/src/index.js";
import { BaseBatchedAuditSink } from "../../packages/integration-sdk/src/index.js";

// ── Datadog Audit Sink ───────────────────────────────────────────────────────

export type DatadogSinkConfig = BatchedAuditSinkOptions & {
  apiKey: string;
  site: string;
  service: string;
  source: string;
  tags?: string;
};

type DatadogLogEntry = {
  ddsource: string;
  ddtags: string;
  hostname: string;
  service: string;
  message: string;
  [key: string]: unknown;
};

function eventToDatadogLog(event: AuditEvent, config: DatadogSinkConfig): DatadogLogEntry {
  const tags = [
    `category:${event.category}`,
    `outcome:${event.outcome}`,
    `action:${event.action}`,
    ...(config.tags ? config.tags.split(",").map((t) => t.trim()) : []),
  ];

  return {
    ddsource: config.source,
    ddtags: tags.join(","),
    hostname: process.env.HOSTNAME ?? "openclaw",
    service: config.service,
    message: `${event.action} outcome=${event.outcome} actor=${event.actor.id}`,
    // Structured fields
    audit: {
      id: event.id,
      timestamp: event.timestamp,
      action: event.action,
      category: event.category,
      outcome: event.outcome,
      actor: event.actor,
      resource: event.resource,
      durationMs: event.durationMs,
      metadata: event.metadata,
    },
  };
}

export class DatadogAuditSink extends BaseBatchedAuditSink {
  private config: DatadogSinkConfig;
  private endpoint: string;

  constructor(logger: PluginLogger, config: DatadogSinkConfig) {
    super(logger, config);
    this.config = config;
    this.endpoint = `https://http-intake.logs.${config.site}/api/v2/logs`;
  }

  protected async flushBatch(events: AuditEvent[]): Promise<void> {
    const logs = events.map((e) => eventToDatadogLog(e, this.config));

    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "DD-API-KEY": this.config.apiKey,
      },
      body: JSON.stringify(logs),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Datadog API returned ${res.status}: ${body}`);
    }
  }
}

// ── Datadog Guardrail Rule ───────────────────────────────────────────────────

/**
 * Example guardrail: blocks bash commands that attempt to exfiltrate
 * Datadog API keys from environment variables.
 */
export class DatadogKeyProtectionRule implements GuardrailRule {
  readonly id = "datadog-key-protection";
  readonly description = "Block commands that may exfiltrate Datadog API keys";

  evaluate(ctx: GuardrailContext): GuardrailResult | null {
    if (ctx.tool !== "bash") {
      return null;
    }
    const input = typeof ctx.input === "string" ? ctx.input : JSON.stringify(ctx.input ?? "");
    const pattern = /\bDD_API_KEY\b|\bDD_APP_KEY\b|\bdatadog.*api[_-]?key/i;
    if (pattern.test(input)) {
      return {
        action: "block",
        reason: "Command may exfiltrate Datadog API keys",
      };
    }
    return null;
  }
}

// ── Health Check ─────────────────────────────────────────────────────────────

async function datadogHealthCheck(apiKey: string, site: string): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const res = await fetch(`https://api.${site}/api/v1/validate`, {
      headers: { "DD-API-KEY": apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    const latencyMs = Date.now() - start;
    if (res.ok) {
      return { status: "healthy", latencyMs };
    }
    return {
      status: "degraded",
      message: `Datadog API returned ${res.status}`,
      latencyMs,
    };
  } catch (err) {
    return {
      status: "unhealthy",
      message: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - start,
    };
  }
}

// ── Plugin Lifecycle ─────────────────────────────────────────────────────────

let pluginState: { apiKey: string; site: string } | null = null;

const plugin: PluginLifecycle = {
  manifest: {
    name: "datadog",
    version: "0.1.0",
    description: "Datadog integration — audit logs, guardrail rules, and health monitoring",
    capabilities: ["audit-sink", "guardrail-rule"],
    configSchema: {
      apiKey: { type: "string", required: true, secret: true, description: "Datadog API key" },
      site: {
        type: "string",
        default: "datadoghq.com",
        description: "Datadog site (e.g. datadoghq.com, datadoghq.eu)",
      },
      service: {
        type: "string",
        default: "openclaw",
        description: "Service name for Datadog logs",
      },
      source: {
        type: "string",
        default: "openclaw-audit",
        description: "Source tag for Datadog logs",
      },
      tags: { type: "string", description: "Comma-separated tags (e.g. env:prod,team:platform)" },
      batchSize: { type: "number", default: 100, description: "Max events per batch" },
      flushIntervalMs: { type: "number", default: 5000, description: "Flush interval in ms" },
    },
  },

  async init(ctx: PluginContext): Promise<PluginExports> {
    const apiKey = await ctx.resolveSecret(ctx.config.apiKey as string);
    const site = (ctx.config.site as string) ?? "datadoghq.com";

    pluginState = { apiKey, site };

    const sinkConfig: DatadogSinkConfig = {
      apiKey,
      site,
      service: (ctx.config.service as string) ?? "openclaw",
      source: (ctx.config.source as string) ?? "openclaw-audit",
      tags: ctx.config.tags as string | undefined,
      batchSize: ctx.config.batchSize as number | undefined,
      flushIntervalMs: ctx.config.flushIntervalMs as number | undefined,
    };

    ctx.logger.info(`Configured for site=${site}, service=${sinkConfig.service}`);

    return {
      auditSinks: [new DatadogAuditSink(ctx.logger, sinkConfig)],
      guardrailRules: [new DatadogKeyProtectionRule()],
    };
  },

  async shutdown(): Promise<void> {
    pluginState = null;
  },

  async healthCheck(): Promise<HealthCheckResult> {
    if (!pluginState) {
      return { status: "unhealthy", message: "Plugin not initialized" };
    }
    return datadogHealthCheck(pluginState.apiKey, pluginState.site);
  },
};

export default plugin;
