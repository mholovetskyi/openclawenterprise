import { describe, it, expect, vi, beforeEach } from "vitest";
import { BaseBatchedAuditSink } from "./base-batched-audit-sink.js";
import type { AuditEvent } from "./interfaces.js";
import type { PluginLogger } from "./lifecycle.js";
import { buildTestEvent, buildTestEvents, createTestLogger } from "./testing.js";

class TestSink extends BaseBatchedAuditSink {
  public batches: AuditEvent[][] = [];
  public shouldFail = false;
  public failCount = 0;
  private failsRemaining = 0;

  constructor(logger: PluginLogger, opts = {}) {
    super(logger, opts);
  }

  /** Make next N flushBatch calls throw */
  failNext(n: number) {
    this.failsRemaining = n;
  }

  protected async flushBatch(events: AuditEvent[]): Promise<void> {
    if (this.shouldFail) {
      this.failCount++;
      throw new Error("test flush failure");
    }
    if (this.failsRemaining > 0) {
      this.failsRemaining--;
      this.failCount++;
      throw new Error("transient failure");
    }
    this.batches.push([...events]);
  }
}

describe("BaseBatchedAuditSink", () => {
  let logger: ReturnType<typeof createTestLogger>;

  beforeEach(() => {
    logger = createTestLogger();
    vi.useFakeTimers();
  });

  it("buffers events and flushes on batchSize", async () => {
    const sink = new TestSink(logger, { batchSize: 3, flushIntervalMs: 60_000 });
    const events = buildTestEvents(3);

    await sink.send(events[0]);
    await sink.send(events[1]);
    expect(sink.batches).toHaveLength(0);

    await sink.send(events[2]);
    expect(sink.batches).toHaveLength(1);
    expect(sink.batches[0]).toHaveLength(3);

    await sink.close();
  });

  it("flushes on timer when batch not full", async () => {
    const sink = new TestSink(logger, { batchSize: 100, flushIntervalMs: 1_000 });
    await sink.send(buildTestEvent());
    expect(sink.batches).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sink.batches).toHaveLength(1);

    await sink.close();
  });

  it("drains buffer on close", async () => {
    const sink = new TestSink(logger, { batchSize: 100 });
    const events = buildTestEvents(5);
    for (const e of events) {
      await sink.send(e);
    }

    expect(sink.batches).toHaveLength(0);
    await sink.close();
    expect(sink.batches).toHaveLength(1);
    expect(sink.batches[0]).toHaveLength(5);
  });

  it("retries on transient failures", async () => {
    vi.useRealTimers();
    const sink = new TestSink(logger, {
      batchSize: 1,
      retryAttempts: 3,
      retryBackoffMs: 1,
    });
    sink.failNext(2); // Fail twice, succeed on third

    await sink.send(buildTestEvent());

    expect(sink.failCount).toBe(2);
    expect(sink.batches).toHaveLength(1);

    await sink.close();
  });

  it("logs error when all retries exhausted", async () => {
    vi.useRealTimers();
    const sink = new TestSink(logger, {
      batchSize: 1,
      retryAttempts: 2,
      retryBackoffMs: 1,
    });
    sink.shouldFail = true;

    await sink.send(buildTestEvent());

    const errorLogs = logger.entries.filter((e) => e.level === "error");
    expect(errorLogs.length).toBeGreaterThan(0);
    expect(errorLogs[0].msg).toContain("Failed to flush");

    await sink.close();
  });

  it("drops oldest events when buffer full", async () => {
    const sink = new TestSink(logger, { batchSize: 100, maxBufferSize: 3 });

    for (let i = 0; i < 5; i++) {
      await sink.send(buildTestEvent());
    }

    expect(sink.bufferedCount).toBe(3);
    const warnLogs = logger.entries.filter((e) => e.level === "warn");
    expect(warnLogs.length).toBe(2); // Dropped 2 events

    await sink.close();
  });

  it("healthCheck reports status", async () => {
    const sink = new TestSink(logger, { batchSize: 1 });
    await sink.send(buildTestEvent());

    const health = await sink.healthCheck();
    expect(health.status).toBe("healthy");
    expect(health.details?.totalSent).toBe(1);

    await sink.close();
    const healthAfterClose = await sink.healthCheck();
    expect(healthAfterClose.status).toBe("unhealthy");
  });
});
