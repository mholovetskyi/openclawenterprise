import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  auditLog,
  auditLogSync,
  setAuditStorage,
  setAuditEnabled,
  seedAuditChain,
  setAuditSinks,
  getAuditStorage,
} from "./logger.js";
import { verifyEventHash } from "./schema.js";
import type { AuditEvent, AuditEventInput } from "./schema.js";
import type { AuditSink } from "./sinks/syslog.js";
import type { AuditStorage } from "./storage/sqlite.js";

const baseInput: AuditEventInput = {
  actor: { type: "user", id: "user-1" },
  action: "auth.login.success",
  category: "auth",
  outcome: "success",
};

function makeMockStorage(): AuditStorage & { events: unknown[] } {
  const events: unknown[] = [];
  return {
    events,
    append: vi.fn(async (event) => {
      events.push(event);
    }),
    query: vi.fn(async () => ({ events: [], total: 0 })),
    getLastHash: vi.fn(async () => undefined),
    count: vi.fn(async () => 0),
    shutdown: vi.fn(async () => {}),
  };
}

describe("auditLog", () => {
  beforeEach(() => {
    setAuditEnabled(false);
    setAuditSinks([]);
    seedAuditChain(undefined);
  });

  it("returns null when audit is disabled", async () => {
    const storage = makeMockStorage();
    setAuditStorage(storage);
    setAuditEnabled(false);
    const result = await auditLog(baseInput);
    expect(result).toBeNull();
    expect(storage.append).not.toHaveBeenCalled();
  });

  it("returns null when no storage is configured", async () => {
    // Reset to no storage by enabling without storage (edge case)
    setAuditEnabled(false);
    const result = await auditLog(baseInput);
    expect(result).toBeNull();
  });

  it("writes an event and returns it when enabled", async () => {
    const storage = makeMockStorage();
    setAuditStorage(storage);
    const event = await auditLog(baseInput);
    expect(event).not.toBeNull();
    expect(storage.append).toHaveBeenCalledOnce();
    expect(storage.append).toHaveBeenCalledWith(event);
  });

  it("returned event passes hash verification", async () => {
    const storage = makeMockStorage();
    setAuditStorage(storage);
    const event = await auditLog(baseInput);
    expect(event).not.toBeNull();
    expect(verifyEventHash(event!)).toBe(true);
  });

  it("event contains the input fields", async () => {
    const storage = makeMockStorage();
    setAuditStorage(storage);
    const event = await auditLog(baseInput);
    expect(event!.actor.id).toBe("user-1");
    expect(event!.action).toBe("auth.login.success");
    expect(event!.outcome).toBe("success");
  });

  it("chains previousHash between consecutive events", async () => {
    const storage = makeMockStorage();
    setAuditStorage(storage);
    const e1 = await auditLog(baseInput);
    const e2 = await auditLog(baseInput);
    expect(e2!.previousHash).toBe(e1!.hash);
  });

  it("swallows storage errors without crashing", async () => {
    const errStorage: AuditStorage = {
      append: vi.fn(async () => {
        throw new Error("disk full");
      }),
      query: vi.fn(async () => ({ events: [], total: 0 })),
      getLastHash: vi.fn(async () => undefined),
      count: vi.fn(async () => 0),
      shutdown: vi.fn(async () => {}),
    };
    setAuditStorage(errStorage);
    // Should not throw
    const result = await auditLog(baseInput);
    expect(result).toBeNull();
  });
});

describe("auditLogSync", () => {
  beforeEach(() => {
    setAuditEnabled(false);
  });

  it("does nothing when disabled", () => {
    const storage = makeMockStorage();
    setAuditStorage(storage);
    setAuditEnabled(false);
    auditLogSync(baseInput);
    // Nothing to assert synchronously — just verifying no error thrown
  });

  it("fires and forgets when enabled", async () => {
    const storage = makeMockStorage();
    setAuditStorage(storage);
    auditLogSync(baseInput);
    // Give the async operation time to complete
    await new Promise((r) => setTimeout(r, 10));
    expect(storage.append).toHaveBeenCalled();
  });
});

describe("getAuditStorage", () => {
  it("returns the configured storage", () => {
    const storage = makeMockStorage();
    setAuditStorage(storage);
    expect(getAuditStorage()).toBe(storage);
  });
});

describe("chain head seeding", () => {
  beforeEach(() => {
    setAuditEnabled(false);
    setAuditSinks([]);
    seedAuditChain(undefined);
  });

  it("first event after a seed chains from the persisted head", async () => {
    const storage = makeMockStorage();
    setAuditStorage(storage);
    // Simulate a restart: the store already has a tail hash/seq.
    seedAuditChain({ hash: "seeded-head-hash", seq: 41 });

    const event = await auditLog(baseInput);
    expect(event).not.toBeNull();
    expect(event!.previousHash).toBe("seeded-head-hash");
    expect(event!.seq).toBe(42);
  });

  it("advances the head only after a durable append, not before", async () => {
    let failNext = true;
    const flaky: AuditStorage = {
      append: vi.fn(async () => {
        if (failNext) {
          failNext = false;
          throw new Error("disk full");
        }
      }),
      query: vi.fn(async () => ({ events: [], total: 0 })),
      getLastHash: vi.fn(async () => undefined),
      count: vi.fn(async () => 0),
      shutdown: vi.fn(async () => {}),
    };
    setAuditStorage(flaky);
    seedAuditChain({ hash: "head-0", seq: 0 });

    // First write fails — the head must NOT advance to the lost event's hash.
    const failed = await auditLog(baseInput);
    expect(failed).toBeNull();

    // Next write must still chain from the last DURABLE head, not the lost event.
    const ok = await auditLog(baseInput);
    expect(ok).not.toBeNull();
    expect(ok!.previousHash).toBe("head-0");
    expect(ok!.seq).toBe(1);
    expect(verifyEventHash(ok!)).toBe(true);
  });
});

describe("sink fan-out", () => {
  beforeEach(() => {
    setAuditEnabled(false);
    setAuditSinks([]);
    seedAuditChain(undefined);
  });

  it("forwards each appended event to every configured sink", async () => {
    const storage = makeMockStorage();
    setAuditStorage(storage);
    const received: AuditEvent[] = [];
    const sink: AuditSink = {
      send: vi.fn(async (e: AuditEvent) => {
        received.push(e);
      }),
      close: vi.fn(async () => {}),
    };
    setAuditSinks([sink]);

    const event = await auditLog(baseInput);
    expect(sink.send).toHaveBeenCalledOnce();
    expect(received[0]).toEqual(event);
  });

  it("one sink failure neither blocks other sinks nor crashes auditLog", async () => {
    const storage = makeMockStorage();
    setAuditStorage(storage);
    const good: AuditSink = { send: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    const bad: AuditSink = {
      send: vi.fn(async () => {
        throw new Error("sink down");
      }),
      close: vi.fn(async () => {}),
    };
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    setAuditSinks([bad, good]);

    const event = await auditLog(baseInput);
    expect(event).not.toBeNull();
    expect(good.send).toHaveBeenCalledOnce();
    stderrSpy.mockRestore();
  });

  it("does not fan out when the storage append fails", async () => {
    const errStorage: AuditStorage = {
      append: vi.fn(async () => {
        throw new Error("disk full");
      }),
      query: vi.fn(async () => ({ events: [], total: 0 })),
      getLastHash: vi.fn(async () => undefined),
      count: vi.fn(async () => 0),
      shutdown: vi.fn(async () => {}),
    };
    setAuditStorage(errStorage);
    const sink: AuditSink = { send: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    setAuditSinks([sink]);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const result = await auditLog(baseInput);
    stderrSpy.mockRestore();

    expect(result).toBeNull();
    expect(sink.send).not.toHaveBeenCalled();
  });
});
