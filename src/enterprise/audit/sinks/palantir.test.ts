import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as tenancy from "../../tenancy/index.js";
import type { AuditEvent } from "../schema.js";
import {
  createPalantirSink,
  type PalantirSinkConfig,
  type PalantirSinkDeps,
  type PalantirSinkMetrics,
  type PalantirAuditRecord,
} from "./palantir.js";

// ── Helpers ─────────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: `EVT_${Math.random().toString(36).slice(2, 10)}`,
    timestamp: new Date().toISOString(),
    version: 1,
    actor: { type: "user", id: "user-1", tenantId: undefined },
    action: "agent.run.start",
    category: "agent",
    outcome: "success",
    hash: "abc123",
    ...overrides,
  };
}

function makeMetrics(): PalantirSinkMetrics & {
  counts: Record<string, number>;
  observations: Array<{ labels: Record<string, string>; value: number }>;
  gaugeValues: Record<string, number>;
} {
  const counts: Record<string, number> = {};
  const observations: Array<{ labels: Record<string, string>; value: number }> = [];
  const gaugeValues: Record<string, number> = {};

  return {
    counts,
    observations,
    gaugeValues,
    eventsTotal: {
      inc(labels?: Record<string, string>, value = 1) {
        const key = labels?.outcome ?? "unknown";
        counts[key] = (counts[key] ?? 0) + value;
      },
    },
    flushDuration: {
      observe(labels: Record<string, string>, value: number) {
        observations.push({ labels, value });
      },
    },
    bufferSize: {
      set(labels: Record<string, string>, value: number) {
        gaugeValues[labels.sink ?? "default"] = value;
      },
    },
  };
}

const defaultConfig: PalantirSinkConfig = {
  stackUrl: "env://PALANTIR_STACK_URL",
  clientId: "env://PALANTIR_CLIENT_ID",
  clientSecret: "env://PALANTIR_CLIENT_SECRET",
  ontologyRid: "env://PALANTIR_ONTOLOGY_RID",
  streamRid: "ri.foundry.main.dataset.abc123",
  batchSize: 10,
  flushIntervalMs: 5_000,
  retryAttempts: 3,
  retryBackoffMs: 10,
  maxBufferSize: 100,
};

function makeMockOsdk() {
  const writtenRecords: PalantirAuditRecord[] = [];
  return {
    writtenRecords,
    modules: {
      createClient: vi.fn((_url: string, _tp: unknown) => ({ _client: true })),
      createConfidentialOauthClient: vi.fn((_id: string, _secret: string, _url: string) => ({
        _tokenProvider: true,
      })),
      Streams: {
        putRecord: vi.fn(
          async (_client: unknown, _rid: string, record: Record<string, unknown>) => {
            writtenRecords.push(record as unknown as PalantirAuditRecord);
          },
        ),
      },
    },
  };
}

function makeDeps(overrides: Partial<PalantirSinkDeps> = {}): PalantirSinkDeps & {
  mockOsdk: ReturnType<typeof makeMockOsdk>;
  metrics: ReturnType<typeof makeMetrics>;
} {
  const mockOsdk = makeMockOsdk();
  const metricsObj = makeMetrics();

  return {
    mockOsdk,
    metrics: metricsObj,
    resolveSecret: vi.fn(async (value: string) => {
      const map: Record<string, string> = {
        "env://PALANTIR_STACK_URL": "https://myorg.palantirfoundry.com",
        "env://PALANTIR_CLIENT_ID": "client-id-123",
        "env://PALANTIR_CLIENT_SECRET": "client-secret-456",
        "env://PALANTIR_ONTOLOGY_RID": "ri.foundry.main.ontology.xxx",
      };
      return map[value] ?? value;
    }),
    osdkLoader: async () => mockOsdk.modules,
    metricsOverride: metricsObj,
    connectivityCheck: vi.fn(async () => {}),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────────

describe("PalantirFoundrySink", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should not flush before flushInterval when batch is not full", async () => {
    const deps = makeDeps();
    const sink = await createPalantirSink(defaultConfig, deps);

    // Emit 5 events with batchSize=10, should not flush
    for (let i = 0; i < 5; i++) {
      await sink.send(makeEvent());
    }

    expect(deps.mockOsdk.modules.Streams.putRecord).not.toHaveBeenCalled();

    await sink.close();
  });

  it("should flush immediately when batch size is reached", async () => {
    const deps = makeDeps();
    const sink = await createPalantirSink(defaultConfig, deps);

    // Emit exactly 10 events with batchSize=10
    for (let i = 0; i < 10; i++) {
      await sink.send(makeEvent());
    }

    expect(deps.mockOsdk.modules.Streams.putRecord).toHaveBeenCalledTimes(10);

    await sink.close();
  });

  it("should map audit event fields to streaming dataset columns", async () => {
    const deps = makeDeps();
    const sink = await createPalantirSink({ ...defaultConfig, batchSize: 1 }, deps);

    const event = makeEvent({
      id: "EVT_001",
      timestamp: "2026-03-10T12:00:00.000Z",
      category: "auth",
      action: "auth.login.success",
      actor: { type: "user", id: "user-42", name: "Alice", tenantId: "tenant-1" },
      resource: { type: "session", id: "sess-abc" },
      outcome: "success",
      durationMs: 150,
      metadata: { ip: "10.0.0.1" },
      previousHash: "prev-hash-123",
    });

    await sink.send(event);

    const record = deps.mockOsdk.writtenRecords[0]!;
    expect(record).toBeDefined();
    expect(record.event_id).toBe("EVT_001");
    expect(record.timestamp).toBe("2026-03-10T12:00:00.000Z");
    expect(record.category).toBe("auth");
    expect(record.action).toBe("auth.login.success");
    expect(record.actor_id).toBe("user-42");
    expect(record.actor_type).toBe("user");
    expect(record.resource_type).toBe("session");
    expect(record.resource_id).toBe("sess-abc");
    expect(record.outcome).toBe("success");
    expect(record.tenant_id).toBe("tenant-1");
    expect(record.duration_ms).toBe(150);
    expect(record.metadata).toBe('{"ip":"10.0.0.1"}');
    expect(record.prev_hash).toBe("prev-hash-123");

    await sink.close();
  });

  it("should resolve secrets through SecretManager", async () => {
    const deps = makeDeps();
    await createPalantirSink(defaultConfig, deps);

    expect(deps.resolveSecret).toHaveBeenCalledWith("env://PALANTIR_STACK_URL");
    expect(deps.resolveSecret).toHaveBeenCalledWith("env://PALANTIR_CLIENT_ID");
    expect(deps.resolveSecret).toHaveBeenCalledWith("env://PALANTIR_CLIENT_SECRET");
    expect(deps.resolveSecret).toHaveBeenCalledWith("env://PALANTIR_ONTOLOGY_RID");
  });

  it("should retry on transient failure with exponential backoff", async () => {
    let callCount = 0;
    const deps = makeDeps({
      writeRecords: async (osdk, client, streamRid, records) => {
        callCount++;
        if (callCount <= 2) {
          throw new Error("Transient network error");
        }
        // Third attempt succeeds
        for (const record of records) {
          await osdk.Streams.putRecord(
            client,
            streamRid,
            record as unknown as Record<string, unknown>,
          );
        }
      },
    });

    const sink = await createPalantirSink(
      { ...defaultConfig, batchSize: 2, retryBackoffMs: 1 },
      deps,
    );

    await sink.send(makeEvent());
    await sink.send(makeEvent());

    // Should have retried and eventually succeeded
    expect(callCount).toBe(3);
    expect(deps.metrics.counts.success).toBe(2);

    await sink.close();
  });

  it("should drop oldest events when buffer overflows", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const deps = makeDeps();

    const sink = await createPalantirSink(
      { ...defaultConfig, batchSize: 200, maxBufferSize: 5 },
      deps,
    );

    // Fill buffer to max (5) and add one more
    for (let i = 0; i < 6; i++) {
      await sink.send(makeEvent({ id: `EVT_${i}` }));
    }

    // Should have dropped one and logged warning
    expect(deps.metrics.counts.dropped).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Buffer full"));

    stderrSpy.mockRestore();
    await sink.close();
  });

  it("should disable sink gracefully on connectivity check failure", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const deps = makeDeps({
      connectivityCheck: async () => {
        throw new Error("Connection refused");
      },
    });

    const sink = await createPalantirSink(defaultConfig, deps);

    // Sink should be a no-op now
    await sink.send(makeEvent());
    expect(deps.mockOsdk.modules.Streams.putRecord).not.toHaveBeenCalled();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to connect to Foundry"));

    stderrSpy.mockRestore();
    await sink.close();
  });

  it("should propagate tenant context to event records", async () => {
    const deps = makeDeps();
    const sink = await createPalantirSink({ ...defaultConfig, batchSize: 1 }, deps);

    await tenancy.runWithTenantAsync({ tenantId: "acme-corp", tenantName: "ACME" }, async () => {
      await sink.send(makeEvent({ actor: { type: "agent", id: "agent-1" } }));
    });

    const record = deps.mockOsdk.writtenRecords[0]!;
    expect(record.tenant_id).toBe("acme-corp");

    await sink.close();
  });

  it("should throw clear error when @osdk packages are missing", async () => {
    const deps = makeDeps({
      osdkLoader: async () => {
        throw new Error("Cannot find module '@osdk/client'");
      },
    });

    await expect(createPalantirSink(defaultConfig, deps)).rejects.toThrow(
      "Cannot find module '@osdk/client'",
    );
  });

  it("should increment success counter on successful flush", async () => {
    const deps = makeDeps();
    const sink = await createPalantirSink({ ...defaultConfig, batchSize: 2 }, deps);

    await sink.send(makeEvent());
    await sink.send(makeEvent());

    expect(deps.metrics.counts.success).toBe(2);

    await sink.close();
  });

  it("should increment error counter when all retries exhausted", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const deps = makeDeps({
      writeRecords: async () => {
        throw new Error("Persistent failure");
      },
    });

    const sink = await createPalantirSink(
      { ...defaultConfig, batchSize: 1, retryAttempts: 1, retryBackoffMs: 1 },
      deps,
    );

    await sink.send(makeEvent());

    expect(deps.metrics.counts.error).toBe(1);

    stderrSpy.mockRestore();
    await sink.close();
  });

  it("should flush remaining buffer on close", async () => {
    const deps = makeDeps();
    const sink = await createPalantirSink(defaultConfig, deps);

    // Add 3 events (below batchSize of 10, so not auto-flushed)
    for (let i = 0; i < 3; i++) {
      await sink.send(makeEvent());
    }

    expect(deps.mockOsdk.modules.Streams.putRecord).not.toHaveBeenCalled();

    await sink.close();

    // After close, all events should be flushed
    expect(deps.mockOsdk.modules.Streams.putRecord).toHaveBeenCalledTimes(3);
  });

  it("should record flush duration in histogram", async () => {
    const deps = makeDeps();
    const sink = await createPalantirSink({ ...defaultConfig, batchSize: 1 }, deps);

    await sink.send(makeEvent());

    expect(deps.metrics.observations.length).toBeGreaterThan(0);
    expect(deps.metrics.observations[0]!.labels.sink).toBe("palantir");
    expect(typeof deps.metrics.observations[0]!.value).toBe("number");

    await sink.close();
  });

  it("should handle events with missing optional fields", async () => {
    const deps = makeDeps();
    const sink = await createPalantirSink({ ...defaultConfig, batchSize: 1 }, deps);

    const event = makeEvent({
      resource: undefined,
      durationMs: undefined,
      metadata: undefined,
      previousHash: undefined,
    });

    await sink.send(event);

    const record = deps.mockOsdk.writtenRecords[0]!;
    expect(record.resource_type).toBe("");
    expect(record.resource_id).toBe("");
    expect(record.duration_ms).toBeNull();
    expect(record.metadata).toBe("{}");
    expect(record.prev_hash).toBe("");

    await sink.close();
  });

  it("should create authenticated client with resolved credentials", async () => {
    const deps = makeDeps();
    await createPalantirSink(defaultConfig, deps);

    expect(deps.mockOsdk.modules.createConfidentialOauthClient).toHaveBeenCalledWith(
      "client-id-123",
      "client-secret-456",
      "https://myorg.palantirfoundry.com",
    );
    expect(deps.mockOsdk.modules.createClient).toHaveBeenCalledWith(
      "https://myorg.palantirfoundry.com",
      expect.anything(),
    );
  });
});
