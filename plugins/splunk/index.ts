/**
 * Splunk integration plugin — audit sink via HTTP Event Collector (HEC).
 *
 * Sends audit events to Splunk HEC endpoint.
 *
 * Config:
 *   enterprise.plugins.pluginConfig.splunk:
 *     hecUrl: https://splunk.internal:8088/services/collector/event
 *     hecToken: env://SPLUNK_HEC_TOKEN
 *     index: openclaw_audit
 *     sourcetype: openclaw:audit
 *     source: openclaw
 *     batchSize: 50
 *     flushIntervalMs: 5000
 *     verifySsl: true
 */

import type {
  AuditEvent,
  HealthCheckResult,
  PluginContext,
  PluginExports,
  PluginLifecycle,
  PluginLogger,
  BatchedAuditSinkOptions,
} from "../../packages/integration-sdk/src/index.js";
import { BaseBatchedAuditSink } from "../../packages/integration-sdk/src/index.js";

// ── Splunk HEC Sink ──────────────────────────────────────────────────────────

export type SplunkSinkConfig = BatchedAuditSinkOptions & {
  hecUrl: string;
  hecToken: string;
  index?: string;
  sourcetype?: string;
  source?: string;
};

type SplunkHecEvent = {
  time: number;
  host: string;
  source: string;
  sourcetype: string;
  index?: string;
  event: Record<string, unknown>;
};

function eventToSplunkHec(event: AuditEvent, config: SplunkSinkConfig): SplunkHecEvent {
  return {
    time: new Date(event.timestamp).getTime() / 1000,
    host: process.env.HOSTNAME ?? "openclaw",
    source: config.source ?? "openclaw",
    sourcetype: config.sourcetype ?? "openclaw:audit",
    index: config.index,
    event: {
      id: event.id,
      action: event.action,
      category: event.category,
      outcome: event.outcome,
      actor: event.actor,
      resource: event.resource,
      durationMs: event.durationMs,
      metadata: event.metadata,
      hash: event.hash,
      previousHash: event.previousHash,
    },
  };
}

export class SplunkAuditSink extends BaseBatchedAuditSink {
  private config: SplunkSinkConfig;

  constructor(logger: PluginLogger, config: SplunkSinkConfig) {
    super(logger, config);
    this.config = config;
  }

  protected async flushBatch(events: AuditEvent[]): Promise<void> {
    // Splunk HEC accepts newline-delimited JSON for batch events
    const body = events.map((e) => JSON.stringify(eventToSplunkHec(e, this.config))).join("\n");

    const res = await fetch(this.config.hecUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Splunk ${this.config.hecToken}`,
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Splunk HEC returned ${res.status}: ${text}`);
    }

    // Check Splunk HEC response for errors
    const result = (await res.json().catch(() => ({}))) as { code?: number; text?: string };
    if (result.code !== undefined && result.code !== 0) {
      throw new Error(`Splunk HEC error code ${result.code}: ${result.text}`);
    }
  }
}

// ── Health Check ─────────────────────────────────────────────────────────────

async function splunkHealthCheck(hecUrl: string, hecToken: string): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    // HEC health endpoint is at /services/collector/health
    const healthUrl = hecUrl.replace(/\/services\/collector.*/, "/services/collector/health");
    const res = await fetch(healthUrl, {
      headers: { Authorization: `Splunk ${hecToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    const latencyMs = Date.now() - start;
    if (res.ok) {
      return { status: "healthy", latencyMs };
    }
    return {
      status: "degraded",
      message: `Splunk HEC health returned ${res.status}`,
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

let pluginState: { hecUrl: string; hecToken: string } | null = null;

const plugin: PluginLifecycle = {
  manifest: {
    name: "splunk",
    version: "0.1.0",
    description: "Splunk integration — audit events via HTTP Event Collector",
    capabilities: ["audit-sink"],
    configSchema: {
      hecUrl: { type: "string", required: true, description: "Splunk HEC endpoint URL" },
      hecToken: { type: "string", required: true, secret: true, description: "Splunk HEC token" },
      index: { type: "string", default: "openclaw_audit", description: "Splunk index name" },
      sourcetype: { type: "string", default: "openclaw:audit", description: "Splunk sourcetype" },
      source: { type: "string", default: "openclaw", description: "Splunk source" },
      batchSize: { type: "number", default: 50, description: "Max events per batch" },
      flushIntervalMs: { type: "number", default: 5000, description: "Flush interval in ms" },
    },
  },

  async init(ctx: PluginContext): Promise<PluginExports> {
    const hecUrl = ctx.config.hecUrl as string;
    const hecToken = await ctx.resolveSecret(ctx.config.hecToken as string);

    pluginState = { hecUrl, hecToken };

    const sinkConfig: SplunkSinkConfig = {
      hecUrl,
      hecToken,
      index: ctx.config.index as string | undefined,
      sourcetype: ctx.config.sourcetype as string | undefined,
      source: ctx.config.source as string | undefined,
      batchSize: ctx.config.batchSize as number | undefined,
      flushIntervalMs: ctx.config.flushIntervalMs as number | undefined,
    };

    ctx.logger.info(`Configured for HEC endpoint: ${hecUrl}`);

    return {
      auditSinks: [new SplunkAuditSink(ctx.logger, sinkConfig)],
    };
  },

  async shutdown(): Promise<void> {
    pluginState = null;
  },

  async healthCheck(): Promise<HealthCheckResult> {
    if (!pluginState) {
      return { status: "unhealthy", message: "Plugin not initialized" };
    }
    return splunkHealthCheck(pluginState.hecUrl, pluginState.hecToken);
  },
};

export default plugin;
