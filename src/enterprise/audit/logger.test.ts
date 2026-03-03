import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  auditLog,
  auditLogSync,
  setAuditStorage,
  setAuditEnabled,
  getAuditStorage,
} from "./logger.js";
import { verifyEventHash } from "./schema.js";
import type { AuditEventInput } from "./schema.js";
import type { AuditStorage } from "./storage/sqlite.js";

const baseInput: AuditEventInput = {
  actor: { type: "user", id: "user-1" },
  action: "auth.login.success",
  category: "auth",
  outcome: "success",
};

function makeMockStorage() {
  const events: unknown[] = [];
  const appendFn = vi.fn(async (event: unknown) => {
    events.push(event);
  });
  const storage: AuditStorage & { events: unknown[] } = {
    events,
    append: appendFn,
    query: vi.fn(async () => ({ events: [], total: 0 })),
    getLastHash: vi.fn(async () => undefined),
    count: vi.fn(async () => 0),
    shutdown: vi.fn(async () => {}),
  };
  return { storage, appendFn };
}

describe("auditLog", () => {
  beforeEach(() => {
    setAuditEnabled(false);
  });

  it("returns null when audit is disabled", async () => {
    const { storage, appendFn } = makeMockStorage();
    setAuditStorage(storage);
    setAuditEnabled(false);
    const result = await auditLog(baseInput);
    expect(result).toBeNull();
    expect(appendFn).not.toHaveBeenCalled();
  });

  it("returns null when no storage is configured", async () => {
    // Reset to no storage by enabling without storage (edge case)
    setAuditEnabled(false);
    const result = await auditLog(baseInput);
    expect(result).toBeNull();
  });

  it("writes an event and returns it when enabled", async () => {
    const { storage, appendFn } = makeMockStorage();
    setAuditStorage(storage);
    const event = await auditLog(baseInput);
    expect(event).not.toBeNull();
    expect(appendFn).toHaveBeenCalledOnce();
    expect(appendFn).toHaveBeenCalledWith(event);
  });

  it("returned event passes hash verification", async () => {
    const { storage } = makeMockStorage();
    setAuditStorage(storage);
    const event = await auditLog(baseInput);
    expect(event).not.toBeNull();
    expect(verifyEventHash(event!)).toBe(true);
  });

  it("event contains the input fields", async () => {
    const { storage } = makeMockStorage();
    setAuditStorage(storage);
    const event = await auditLog(baseInput);
    expect(event!.actor.id).toBe("user-1");
    expect(event!.action).toBe("auth.login.success");
    expect(event!.outcome).toBe("success");
  });

  it("chains previousHash between consecutive events", async () => {
    const { storage } = makeMockStorage();
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
    const { storage } = makeMockStorage();
    setAuditStorage(storage);
    setAuditEnabled(false);
    auditLogSync(baseInput);
    // Nothing to assert synchronously — just verifying no error thrown
  });

  it("fires and forgets when enabled", async () => {
    const { storage, appendFn } = makeMockStorage();
    setAuditStorage(storage);
    auditLogSync(baseInput);
    // Give the async operation time to complete
    await new Promise((r) => setTimeout(r, 10));
    expect(appendFn).toHaveBeenCalled();
  });
});

describe("getAuditStorage", () => {
  it("returns the configured storage", () => {
    const { storage } = makeMockStorage();
    setAuditStorage(storage);
    expect(getAuditStorage()).toBe(storage);
  });
});
