/**
 * Palantir Foundry audit sink — streams audit events to a Foundry streaming dataset.
 *
 * Activation in config:
 *   enterprise:
 *     audit:
 *       sinks:
 *         - type: palantir-foundry
 *           stackUrl: env://PALANTIR_STACK_URL
 *           clientId: env://PALANTIR_CLIENT_ID
 *           clientSecret: env://PALANTIR_CLIENT_SECRET
 *           ontologyRid: env://PALANTIR_ONTOLOGY_RID
 *           streamRid: "ri.foundry.main.dataset.abc123"
 *
 * Requires optional @osdk/* packages:
 *   npm install @osdk/client @osdk/oauth @osdk/foundry.streams
 */

import { metrics } from "../../monitoring/metrics.js";
import { getTenantContext } from "../../tenancy/index.js";
import type { AuditEvent } from "../schema.js";
import type { AuditSink } from "./syslog.js";

// ── Config ─────────────────────────────────────────────────────────────────────

export type PalantirSinkConfig = {
  stackUrl: string;
  clientId: string;
  clientSecret: string;
  ontologyRid: string;
  streamRid: string;
  batchSize?: number;
  flushIntervalMs?: number;
  retryAttempts?: number;
  retryBackoffMs?: number;
  maxBufferSize?: number;
};

// ── Palantir metrics ────────────────────────────────────────────────────────────

export type PalantirSinkMetrics = {
  eventsTotal: { inc(labels?: Record<string, string>, value?: number): void };
  flushDuration: { observe(labels: Record<string, string>, value: number): void };
  bufferSize: { set(labels: Record<string, string>, value: number): void };
};

// ── Stream record schema ────────────────────────────────────────────────────────

export type PalantirAuditRecord = {
  event_id: string;
  timestamp: string;
  category: string;
  action: string;
  actor_id: string;
  actor_type: string;
  resource_type: string;
  resource_id: string;
  outcome: string;
  tenant_id: string | null;
  duration_ms: number | null;
  metadata: string;
  prev_hash: string;
};

function eventToRecord(event: AuditEvent): PalantirAuditRecord {
  const tenantCtx = getTenantContext();
  return {
    event_id: event.id,
    timestamp: event.timestamp,
    category: event.category,
    action: event.action,
    actor_id: event.actor.id,
    actor_type: event.actor.type,
    resource_type: event.resource?.type ?? "",
    resource_id: event.resource?.id ?? "",
    outcome: event.outcome,
    tenant_id: event.actor.tenantId ?? tenantCtx.tenantId ?? null,
    duration_ms: event.durationMs ?? null,
    metadata: event.metadata ? JSON.stringify(event.metadata) : "{}",
    prev_hash: event.previousHash ?? "",
  };
}

// ── OSDK loader ─────────────────────────────────────────────────────────────────

type OsdkModules = {
  createClient: (stackUrl: string, tokenProvider: unknown) => unknown;
  createConfidentialOauthClient: (
    clientId: string,
    clientSecret: string,
    stackUrl: string,
  ) => unknown;
  Streams: {
    putRecord: (
      client: unknown,
      streamRid: string,
      record: Record<string, unknown>,
    ) => Promise<void>;
  };
};

// Structural shapes of the optional @osdk/* packages (zero-dep policy: never
// compile-time dependencies; operators install them to enable this sink).
type OsdkClientModule = { createClient: OsdkModules["createClient"] };
type OsdkOauthModule = {
  createConfidentialOauthClient: OsdkModules["createConfidentialOauthClient"];
};
type OsdkStreamsModule = OsdkModules["Streams"] & { Streams?: OsdkModules["Streams"] };

async function loadOsdkModules(): Promise<OsdkModules> {
  try {
    // Non-literal specifiers keep TypeScript from statically resolving these
    // optional packages; loading stays lazy at runtime.
    const specifiers: string[] = ["@osdk/client", "@osdk/oauth", "@osdk/foundry.streams"];
    const [clientMod, oauthMod, streamsMod] = (await Promise.all(
      specifiers.map((specifier) => import(specifier)),
    )) as [OsdkClientModule, OsdkOauthModule, OsdkStreamsModule];
    return {
      createClient: clientMod.createClient,
      createConfidentialOauthClient: oauthMod.createConfidentialOauthClient,
      Streams: streamsMod.Streams ?? streamsMod,
    };
  } catch {
    throw new Error(
      "Palantir Foundry audit sink requires @osdk/client, @osdk/oauth, and @osdk/foundry.streams. " +
        "Install with: npm install @osdk/client @osdk/oauth @osdk/foundry.streams",
    );
  }
}

// ── Sink implementation ─────────────────────────────────────────────────────────

export type PalantirSinkDeps = {
  resolveSecret: (value: string) => Promise<string>;
  osdkLoader?: () => Promise<OsdkModules>;
  metricsOverride?: PalantirSinkMetrics;
  connectivityCheck?: (client: unknown, stackUrl: string) => Promise<void>;
  writeRecords?: (
    osdk: OsdkModules,
    client: unknown,
    streamRid: string,
    records: PalantirAuditRecord[],
  ) => Promise<void>;
};

async function defaultWriteRecords(
  osdk: OsdkModules,
  client: unknown,
  streamRid: string,
  records: PalantirAuditRecord[],
): Promise<void> {
  for (const record of records) {
    await osdk.Streams.putRecord(client, streamRid, record as unknown as Record<string, unknown>);
  }
}

async function defaultConnectivityCheck(_client: unknown, stackUrl: string): Promise<void> {
  const res = await fetch(`${stackUrl}/api/v1/health`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new Error(`Foundry health check returned HTTP ${res.status}`);
  }
}

export async function createPalantirSink(
  config: PalantirSinkConfig,
  deps: PalantirSinkDeps,
): Promise<AuditSink> {
  const batchSize = config.batchSize ?? 50;
  const flushMs = config.flushIntervalMs ?? 5_000;
  const retryAttempts = config.retryAttempts ?? 3;
  const retryBackoffMs = config.retryBackoffMs ?? 1_000;
  const maxBufferSize = config.maxBufferSize ?? 10_000;

  // Resolve secrets
  const [stackUrl, clientId, clientSecret, _ontologyRid] = await Promise.all([
    deps.resolveSecret(config.stackUrl),
    deps.resolveSecret(config.clientId),
    deps.resolveSecret(config.clientSecret),
    deps.resolveSecret(config.ontologyRid),
  ]);

  // Load OSDK
  const loader = deps.osdkLoader ?? loadOsdkModules;
  const osdk = await loader();

  // Create authenticated client
  const tokenProvider = osdk.createConfidentialOauthClient(clientId, clientSecret, stackUrl);
  const client = osdk.createClient(stackUrl, tokenProvider);

  // Metrics
  const sinkMetrics = deps.metricsOverride ?? {
    eventsTotal: metrics.auditEvents,
    flushDuration: metrics.gatewayRequestDuration,
    bufferSize: metrics.sandboxMemoryMb,
  };

  // Connectivity check
  const checkConnectivity = deps.connectivityCheck ?? defaultConnectivityCheck;
  try {
    await checkConnectivity(client, stackUrl);
  } catch (err) {
    process.stderr.write(
      `[palantir-sink] Failed to connect to Foundry at ${stackUrl}: ${String(err)}. Sink disabled.\n`,
    );
    // Return a no-op sink
    return {
      async send() {},
      async close() {},
    };
  }

  // State
  let buffer: AuditEvent[] = [];
  let flushTimer: NodeJS.Timeout | null = null;
  let flushing = false;
  const writeRecords = deps.writeRecords ?? defaultWriteRecords;

  async function flushWithRetry(): Promise<void> {
    if (buffer.length === 0 || flushing) {
      return;
    }
    flushing = true;
    const toSend = buffer.splice(0, batchSize);
    const records = toSend.map(eventToRecord);

    sinkMetrics.bufferSize.set({ sink: "palantir" }, buffer.length);

    const startTime = Date.now();
    let lastErr: Error | undefined;

    for (let attempt = 0; attempt <= retryAttempts; attempt++) {
      try {
        await writeRecords(osdk, client, config.streamRid, records);
        sinkMetrics.eventsTotal.inc({ outcome: "success" }, toSend.length);
        const elapsed = (Date.now() - startTime) / 1000;
        sinkMetrics.flushDuration.observe({ sink: "palantir" }, elapsed);
        flushing = false;
        return;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (attempt < retryAttempts) {
          const delay = retryBackoffMs * Math.pow(2, attempt);
          await new Promise<void>((r) => setTimeout(r, delay));
        }
      }
    }

    // All retries exhausted
    sinkMetrics.eventsTotal.inc({ outcome: "error" }, toSend.length);
    process.stderr.write(
      `[palantir-sink] Failed to flush ${toSend.length} events after ${retryAttempts + 1} attempts: ${lastErr}\n`,
    );
    flushing = false;
  }

  function scheduleFlush() {
    if (!flushTimer) {
      flushTimer = setTimeout(async () => {
        flushTimer = null;
        await flushWithRetry();
      }, flushMs);
      flushTimer.unref?.();
    }
  }

  // Graceful shutdown
  const shutdownHandler = async () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await flushWithRetry();
  };

  process.on("SIGTERM", shutdownHandler);
  process.on("SIGINT", shutdownHandler);

  return {
    async send(event: AuditEvent): Promise<void> {
      if (buffer.length >= maxBufferSize) {
        // Drop oldest event
        buffer.shift();
        sinkMetrics.eventsTotal.inc({ outcome: "dropped" }, 1);
        process.stderr.write(
          `[palantir-sink] Buffer full (${maxBufferSize}), dropping oldest event\n`,
        );
      }
      buffer.push(event);
      sinkMetrics.bufferSize.set({ sink: "palantir" }, buffer.length);

      if (buffer.length >= batchSize) {
        await flushWithRetry();
      } else {
        scheduleFlush();
      }
    },

    async close(): Promise<void> {
      process.removeListener("SIGTERM", shutdownHandler);
      process.removeListener("SIGINT", shutdownHandler);
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      // Flush remaining
      while (buffer.length > 0) {
        await flushWithRetry();
      }
    },
  };
}
