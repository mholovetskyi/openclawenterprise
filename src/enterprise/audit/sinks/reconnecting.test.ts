import { describe, it, expect, vi } from "vitest";
import type { AuditEvent } from "../schema.js";
import { createReconnectingSink, type ReconnectingSinkMetrics } from "./reconnecting.js";
import type { AuditSink } from "./syslog.js";

function makeEvent(id: string): AuditEvent {
  return {
    id,
    timestamp: new Date().toISOString(),
    version: 1,
    actor: { type: "user", id: "u" },
    action: "a",
    category: "system",
    outcome: "success",
    hash: id,
  };
}

function makeMetrics(): ReconnectingSinkMetrics & { counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  return {
    counts,
    eventsTotal: {
      inc(labels?: Record<string, string>, value = 1) {
        counts[labels?.outcome ?? "?"] = (counts[labels?.outcome ?? "?"] ?? 0) + value;
      },
    },
    bufferSize: { set() {} },
  };
}

describe("createReconnectingSink", () => {
  it("buffers while down, then drains to the live sink once connectivity returns", async () => {
    let healthy = false;
    const received: AuditEvent[] = [];
    const live: AuditSink = {
      send: vi.fn(async (e: AuditEvent) => {
        received.push(e);
      }),
      close: vi.fn(async () => {}),
    };
    const metrics = makeMetrics();

    const sink = createReconnectingSink({
      label: "test",
      check: async () => {
        if (!healthy) throw new Error("down");
      },
      makeLive: () => live,
      metrics,
      maxBufferSize: 100,
      retryIntervalMs: 5,
    });

    // Emits an observable "degraded" signal rather than a silent no-op.
    expect(metrics.counts.degraded).toBe(1);

    await sink.send(makeEvent("e1"));
    await sink.send(makeEvent("e2"));
    expect(live.send).not.toHaveBeenCalled(); // still buffered while disconnected

    // Connectivity is restored; the next retry should go live and drain.
    healthy = true;
    await vi.waitFor(() => {
      expect(received.map((e) => e.id)).toEqual(["e1", "e2"]);
    });

    // Subsequent events go straight through the live sink.
    await sink.send(makeEvent("e3"));
    expect(received.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);

    await sink.close();
    expect(live.close).toHaveBeenCalledOnce();
  });

  it("drops oldest and counts drops when the buffer overflows while down", async () => {
    const metrics = makeMetrics();
    const sink = createReconnectingSink({
      label: "test",
      check: async () => {
        throw new Error("down");
      },
      makeLive: () => ({ send: async () => {}, close: async () => {} }),
      metrics,
      maxBufferSize: 2,
      retryIntervalMs: 10_000,
    });

    for (let i = 0; i < 5; i++) await sink.send(makeEvent(`e${i}`));
    expect(metrics.counts.dropped).toBe(3);
    await sink.close();
  });
});
