/**
 * OCI Streaming audit sink — streams audit events to Oracle Cloud Streaming.
 *
 * Activation in config:
 *   enterprise:
 *     audit:
 *       sinks:
 *         - type: oci-streaming
 *           streamId: env://OCI_STREAM_ID
 *           streamEndpoint: env://OCI_STREAMING_ENDPOINT
 *           tenancyId: env://OCI_TENANCY_ID
 *           userId: env://OCI_USER_ID
 *           fingerprint: env://OCI_FINGERPRINT
 *           privateKey: env://OCI_PRIVATE_KEY
 *           region: us-ashburn-1
 *
 * Requires optional oci-sdk package:
 *   npm install oci-sdk
 */

import { metrics } from "../../monitoring/metrics.js";
import { getTenantContext } from "../../tenancy/index.js";
import type { AuditEvent } from "../schema.js";
import { createReconnectingSink } from "./reconnecting.js";
import type { AuditSink } from "./syslog.js";

// ── Config ─────────────────────────────────────────────────────────────────────

export type OciStreamingSinkConfig = {
  streamId: string;
  streamEndpoint: string;
  tenancyId?: string;
  userId?: string;
  fingerprint?: string;
  privateKey?: string;
  region?: string;
  batchSize?: number;
  flushIntervalMs?: number;
  partitionKey?: string;
  retryAttempts?: number;
  retryBackoffMs?: number;
  maxBufferSize?: number;
};

// ── OCI SDK types ──────────────────────────────────────────────────────────────

type OciStreamClient = {
  putMessages(req: {
    streamId: string;
    putMessagesDetails: { messages: Array<{ key: string; value: string }> };
  }): Promise<{ entries: Array<{ error?: string }> }>;
  getStream(req: { streamId: string }): Promise<{
    stream: { lifecycleState: string; name: string };
  }>;
};

type OciStreamClientCtor = new (params: Record<string, unknown>) => OciStreamClient;

/**
 * Structural shape of the optional `oci-sdk` package (zero-dep policy: it is
 * never a compile-time dependency; operators install it to enable this sink).
 */
type OciSdkModule = {
  StreamClient?: OciStreamClientCtor;
  streaming?: { StreamClient?: OciStreamClientCtor };
};

// ── Metrics ────────────────────────────────────────────────────────────────────

export type OciStreamingSinkMetrics = {
  eventsTotal: { inc(labels?: Record<string, string>, value?: number): void };
  flushDuration: { observe(labels: Record<string, string>, value: number): void };
  bufferSize: { set(labels: Record<string, string>, value: number): void };
};

// ── Deps ───────────────────────────────────────────────────────────────────────

export type OciStreamingSinkDeps = {
  resolveSecret: (value: string) => Promise<string>;
  streamClient?: OciStreamClient;
  metricsOverride?: OciStreamingSinkMetrics;
  sdkLoader?: () => Promise<{
    StreamClient: new (params: Record<string, unknown>) => OciStreamClient;
  }>;
};

function eventToMessage(event: AuditEvent, _partitionKey: string): { key: string; value: string } {
  const tenantCtx = getTenantContext();
  const enriched = {
    ...event,
    tenant_id: event.actor.tenantId ?? tenantCtx.tenantId ?? null,
  };
  return {
    key: Buffer.from(event.id).toString("base64"),
    value: Buffer.from(JSON.stringify(enriched)).toString("base64"),
  };
}

export async function createOciStreamingSink(
  config: OciStreamingSinkConfig,
  deps: OciStreamingSinkDeps,
): Promise<AuditSink> {
  const batchSize = config.batchSize ?? 100;
  const flushMs = config.flushIntervalMs ?? 5_000;
  const partitionKey = config.partitionKey ?? "openclaw-audit";
  const retryAttempts = config.retryAttempts ?? 3;
  const retryBackoffMs = config.retryBackoffMs ?? 1_000;
  const maxBufferSize = config.maxBufferSize ?? 10_000;
  const OCI_MAX_MESSAGES_PER_CALL = 5;

  // Resolve secrets
  const [streamId, streamEndpoint] = await Promise.all([
    deps.resolveSecret(config.streamId),
    deps.resolveSecret(config.streamEndpoint),
  ]);

  // Get or create stream client
  let streamClient = deps.streamClient ?? null;
  if (!streamClient) {
    const loader = deps.sdkLoader;
    if (!loader) {
      try {
        // Non-literal specifier keeps TypeScript from statically resolving
        // this optional package; loading stays lazy at runtime.
        const specifier: string = "oci-sdk";
        // Structural shape of the optional oci-sdk package.
        // SAFETY: the StreamClient export it declares is re-checked at runtime immediately below before use.
        const mod = (await import(specifier)) as OciSdkModule;
        const ClientClass = mod.StreamClient ?? mod.streaming?.StreamClient;
        if (!ClientClass) {
          throw new Error("oci-sdk does not export StreamClient");
        }
        const authConfig: Record<string, unknown> = { endpoint: streamEndpoint };
        if (config.tenancyId) {
          authConfig.tenancyId = config.tenancyId;
        }
        if (config.userId) {
          authConfig.userId = config.userId;
        }
        if (config.region) {
          authConfig.region = config.region;
        }
        streamClient = new ClientClass(authConfig);
      } catch {
        throw new Error(
          "OCI Streaming audit sink requires oci-sdk. Install with: npm install oci-sdk",
        );
      }
    } else {
      const sdk = await loader();
      streamClient = new sdk.StreamClient({ endpoint: streamEndpoint });
    }
  }

  if (!streamClient) {
    throw new Error("OCI Streaming audit sink: failed to initialize StreamClient");
  }
  const client = streamClient;

  // Metrics
  const sinkMetrics = deps.metricsOverride ?? {
    eventsTotal: metrics.auditEvents,
    flushDuration: metrics.gatewayRequestDuration,
    bufferSize: metrics.sandboxMemoryMb,
  };

  // Startup validation. On failure we do NOT install a permanent silent no-op —
  // instead we buffer and keep retrying so the sink can recover and its degraded
  // state is observable via metrics rather than only a boot-time stderr line.
  async function validateStream(): Promise<void> {
    const resp = await client.getStream({ streamId });
    if (resp.stream.lifecycleState !== "ACTIVE") {
      throw new Error(`Stream ${streamId} is ${resp.stream.lifecycleState}, not ACTIVE`);
    }
  }

  try {
    await validateStream();
  } catch (err) {
    process.stderr.write(
      `[oci-streaming] Failed to validate stream ${streamId}: ${String(err)}. ` +
        `Buffering events and retrying.\n`,
    );
    return createReconnectingSink({
      label: "oci-streaming",
      check: validateStream,
      makeLive: createLiveSink,
      metrics: sinkMetrics,
      maxBufferSize,
      retryIntervalMs: retryBackoffMs,
    });
  }

  return createLiveSink();

  function createLiveSink(): AuditSink {
    // State
    let buffer: AuditEvent[] = [];
    let flushTimer: NodeJS.Timeout | null = null;
    let flushing = false;

    async function flushWithRetry(): Promise<void> {
      if (buffer.length === 0 || flushing) {
        return;
      }
      flushing = true;
      const toSend = buffer.splice(0, batchSize);
      const messages = toSend.map((e) => eventToMessage(e, partitionKey));

      sinkMetrics.bufferSize.set({ sink: "oci-streaming" }, buffer.length);
      const startTime = Date.now();
      let lastErr: Error | undefined;

      for (let attempt = 0; attempt <= retryAttempts; attempt++) {
        try {
          // Chunk into groups of OCI_MAX_MESSAGES_PER_CALL
          for (let i = 0; i < messages.length; i += OCI_MAX_MESSAGES_PER_CALL) {
            const chunk = messages.slice(i, i + OCI_MAX_MESSAGES_PER_CALL);
            await client.putMessages({
              streamId,
              putMessagesDetails: { messages: chunk },
            });
          }
          sinkMetrics.eventsTotal.inc({ outcome: "success" }, toSend.length);
          const elapsed = (Date.now() - startTime) / 1000;
          sinkMetrics.flushDuration.observe({ sink: "oci-streaming" }, elapsed);
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

      sinkMetrics.eventsTotal.inc({ outcome: "error" }, toSend.length);
      process.stderr.write(
        `[oci-streaming] Failed to flush ${toSend.length} events after ${retryAttempts + 1} attempts: ${String(lastErr)}\n`,
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
          buffer.shift();
          sinkMetrics.eventsTotal.inc({ outcome: "dropped" }, 1);
          process.stderr.write(
            `[oci-streaming] Buffer full (${maxBufferSize}), dropping oldest event\n`,
          );
        }
        buffer.push(event);
        sinkMetrics.bufferSize.set({ sink: "oci-streaming" }, buffer.length);
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
        while (buffer.length > 0) {
          await flushWithRetry();
        }
      },
    };
  }
}
