import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as tenancy from "../../tenancy/index.js";
import type { AuditEvent } from "../schema.js";
import {
  createOciStreamingSink,
  type OciStreamingSinkConfig,
  type OciStreamingSinkDeps,
  type OciStreamingSinkMetrics,
} from "./oci-streaming.js";

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: `EVT_${Math.random().toString(36).slice(2, 10)}`,
    timestamp: new Date().toISOString(),
    version: 1,
    actor: { type: "user", id: "user-1" },
    action: "agent.run.start",
    category: "agent",
    outcome: "success",
    hash: "abc123",
    ...overrides,
  };
}

function makeMetrics(): OciStreamingSinkMetrics & {
  counts: Record<string, number>;
  observations: Array<{ labels: Record<string, string>; value: number }>;
} {
  const counts: Record<string, number> = {};
  const observations: Array<{ labels: Record<string, string>; value: number }> = [];
  return {
    counts,
    observations,
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
      set() {},
    },
  };
}

function makeMockStreamClient() {
  const putCalls: Array<{ messages: Array<{ key: string; value: string }> }> = [];
  return {
    putCalls,
    client: {
      putMessages: vi.fn(
        async (req: {
          putMessagesDetails: { messages: Array<{ key: string; value: string }> };
        }) => {
          putCalls.push(req.putMessagesDetails);
          return { entries: req.putMessagesDetails.messages.map(() => ({})) };
        },
      ),
      getStream: vi.fn(async () => ({
        stream: { lifecycleState: "ACTIVE", name: "test-stream" },
      })),
    },
  };
}

const defaultConfig: OciStreamingSinkConfig = {
  streamId: "ocid1.stream.oc1.iad.xxx",
  streamEndpoint: "https://streaming.us-ashburn-1.oci.oraclecloud.com",
  batchSize: 10,
  flushIntervalMs: 5_000,
  retryAttempts: 2,
  retryBackoffMs: 1,
  maxBufferSize: 50,
};

function makeDeps(overrides: Partial<OciStreamingSinkDeps> = {}) {
  const mock = makeMockStreamClient();
  const metricsObj = makeMetrics();
  return {
    mock,
    metrics: metricsObj,
    deps: {
      resolveSecret: vi.fn(async (v: string) => v),
      streamClient: mock.client,
      metricsOverride: metricsObj,
      ...overrides,
    } as OciStreamingSinkDeps,
  };
}

describe("OciStreamingSink", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("should not flush before batch size is reached", async () => {
    const { mock, deps } = makeDeps();
    const sink = await createOciStreamingSink(defaultConfig, deps);
    for (let i = 0; i < 5; i++) {
      await sink.send(makeEvent());
    }
    expect(mock.client.putMessages).not.toHaveBeenCalled();
    await sink.close();
  });

  it("should flush when batch size is reached", async () => {
    const { mock, deps } = makeDeps();
    const sink = await createOciStreamingSink(defaultConfig, deps);
    for (let i = 0; i < 10; i++) {
      await sink.send(makeEvent());
    }
    expect(mock.client.putMessages).toHaveBeenCalled();
    await sink.close();
  });

  it("should chunk messages into groups of 5 per putMessages call", async () => {
    const { mock, deps } = makeDeps();
    const sink = await createOciStreamingSink(defaultConfig, deps);
    for (let i = 0; i < 10; i++) {
      await sink.send(makeEvent());
    }

    // 10 events / 5 per call = 2 putMessages calls
    expect(mock.client.putMessages).toHaveBeenCalledTimes(2);
    expect(mock.putCalls[0]!.messages.length).toBe(5);
    expect(mock.putCalls[1]!.messages.length).toBe(5);
    await sink.close();
  });

  it("should JSON-serialize audit events as base64 message values", async () => {
    const { mock, deps } = makeDeps();
    const sink = await createOciStreamingSink({ ...defaultConfig, batchSize: 1 }, deps);
    const event = makeEvent({ id: "EVT_JSON_TEST" });
    await sink.send(event);

    const msg = mock.putCalls[0]!.messages[0]!;
    const decoded = JSON.parse(Buffer.from(msg.value, "base64").toString("utf8")) as Record<
      string,
      unknown
    >;
    expect(decoded.id).toBe("EVT_JSON_TEST");
    await sink.close();
  });

  it("should use event ID as base64 message key", async () => {
    const { mock, deps } = makeDeps();
    const sink = await createOciStreamingSink({ ...defaultConfig, batchSize: 1 }, deps);
    await sink.send(makeEvent({ id: "EVT_KEY_TEST" }));

    const msg = mock.putCalls[0]!.messages[0]!;
    expect(Buffer.from(msg.key, "base64").toString("utf8")).toBe("EVT_KEY_TEST");
    await sink.close();
  });

  it("should retry on transient OCI errors", async () => {
    let callCount = 0;
    const { deps } = makeDeps({
      streamClient: {
        putMessages: vi.fn(async () => {
          callCount++;
          if (callCount <= 2) {
            throw Object.assign(new Error("throttled"), { statusCode: 429 });
          }
          return { entries: [] };
        }),
        getStream: vi.fn(async () => ({ stream: { lifecycleState: "ACTIVE", name: "s" } })),
      },
    });

    const sink = await createOciStreamingSink({ ...defaultConfig, batchSize: 1 }, deps);
    await sink.send(makeEvent());
    expect(callCount).toBe(3);
    await sink.close();
  });

  it("should drop oldest events on buffer overflow", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { deps, metrics: m } = makeDeps();
    const sink = await createOciStreamingSink(
      { ...defaultConfig, batchSize: 200, maxBufferSize: 5 },
      deps,
    );

    for (let i = 0; i < 6; i++) {
      await sink.send(makeEvent());
    }
    expect(m.counts.dropped).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Buffer full"));

    stderrSpy.mockRestore();
    await sink.close();
  });

  it("should disable sink when stream is not ACTIVE", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { deps } = makeDeps({
      streamClient: {
        putMessages: vi.fn(),
        getStream: vi.fn(async () => ({ stream: { lifecycleState: "DELETING", name: "s" } })),
      },
    });

    const sink = await createOciStreamingSink(defaultConfig, deps);
    await sink.send(makeEvent());
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("DELETING"));

    stderrSpy.mockRestore();
    await sink.close();
  });

  it("should disable sink when getStream fails", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { deps } = makeDeps({
      streamClient: {
        putMessages: vi.fn(),
        getStream: vi.fn(async () => {
          throw new Error("connection refused");
        }),
      },
    });

    const sink = await createOciStreamingSink(defaultConfig, deps);
    await sink.send(makeEvent());
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to validate stream"));

    stderrSpy.mockRestore();
    await sink.close();
  });

  it("should flush remaining buffer on close", async () => {
    const { mock, deps } = makeDeps();
    const sink = await createOciStreamingSink(defaultConfig, deps);
    for (let i = 0; i < 3; i++) {
      await sink.send(makeEvent());
    }
    expect(mock.client.putMessages).not.toHaveBeenCalled();
    await sink.close();
    expect(mock.client.putMessages).toHaveBeenCalled();
  });

  it("should propagate tenant context", async () => {
    const { mock, deps } = makeDeps();
    const sink = await createOciStreamingSink({ ...defaultConfig, batchSize: 1 }, deps);

    await tenancy.runWithTenantAsync({ tenantId: "acme", tenantName: "ACME" }, async () => {
      await sink.send(makeEvent());
    });

    const msg = mock.putCalls[0]!.messages[0]!;
    const decoded = JSON.parse(Buffer.from(msg.value, "base64").toString("utf8")) as Record<
      string,
      unknown
    >;
    expect(decoded.tenant_id).toBe("acme");
    await sink.close();
  });

  it("should increment success counter on successful flush", async () => {
    const { deps, metrics: m } = makeDeps();
    const sink = await createOciStreamingSink({ ...defaultConfig, batchSize: 2 }, deps);
    await sink.send(makeEvent());
    await sink.send(makeEvent());
    expect(m.counts.success).toBe(2);
    await sink.close();
  });

  it("should increment error counter when all retries exhausted", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { deps, metrics: m } = makeDeps({
      streamClient: {
        putMessages: vi.fn(async () => {
          throw new Error("permanent");
        }),
        getStream: vi.fn(async () => ({ stream: { lifecycleState: "ACTIVE", name: "s" } })),
      },
    });

    const sink = await createOciStreamingSink({ ...defaultConfig, batchSize: 1 }, deps);
    await sink.send(makeEvent());
    expect(m.counts.error).toBe(1);

    stderrSpy.mockRestore();
    await sink.close();
  });
});
