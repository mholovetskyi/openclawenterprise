import { describe, it, expect } from "vitest";
import {
  buildAuditEvent,
  verifyEventHash,
  verifyChain,
  AUDIT_ACTIONS,
  type AuditEvent,
  type AuditEventInput,
} from "./schema.js";

const baseInput: AuditEventInput = {
  actor: { type: "user", id: "user-1", email: "test@example.com" },
  action: AUDIT_ACTIONS.AGENT_RUN_START,
  category: "agent",
  outcome: "success",
};

describe("buildAuditEvent", () => {
  it("returns an event with required fields", () => {
    const event = buildAuditEvent(baseInput);
    expect(event.id).toBeTruthy();
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(event.version).toBe(1);
    expect(event.actor).toEqual(baseInput.actor);
    expect(event.action).toBe(baseInput.action);
    expect(event.category).toBe("agent");
    expect(event.outcome).toBe("success");
  });

  it("computes a non-empty SHA-256 hash", () => {
    const event = buildAuditEvent(baseInput);
    expect(event.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("includes previousHash when supplied", () => {
    const prev = buildAuditEvent(baseInput);
    const next = buildAuditEvent(baseInput, prev.hash);
    expect(next.previousHash).toBe(prev.hash);
  });

  it("sets previousHash to undefined when not supplied", () => {
    const event = buildAuditEvent(baseInput);
    expect(event.previousHash).toBeUndefined();
  });

  it("IDs are unique across sequential calls", () => {
    const a = buildAuditEvent(baseInput);
    const b = buildAuditEvent(baseInput);
    expect(a.id).not.toBe(b.id);
  });

  it("propagates optional metadata fields", () => {
    const event = buildAuditEvent({
      ...baseInput,
      resource: { type: "agent", id: "agent-1", name: "MyAgent" },
      metadata: { key: "value" },
      durationMs: 123,
    });
    expect(event.resource?.type).toBe("agent");
    expect(event.metadata?.key).toBe("value");
    expect(event.durationMs).toBe(123);
  });
});

describe("verifyEventHash", () => {
  it("returns true for a freshly built event", () => {
    const event = buildAuditEvent(baseInput);
    expect(verifyEventHash(event)).toBe(true);
  });

  it("returns false when the hash field is tampered", () => {
    const event = buildAuditEvent(baseInput);
    const tampered: AuditEvent = { ...event, hash: "00".repeat(32) };
    expect(verifyEventHash(tampered)).toBe(false);
  });

  it("returns false when a content field is changed", () => {
    const event = buildAuditEvent(baseInput);
    const tampered: AuditEvent = { ...event, outcome: "failure" };
    expect(verifyEventHash(tampered)).toBe(false);
  });
});

describe("verifyChain", () => {
  function buildChain(length: number): AuditEvent[] {
    const events: AuditEvent[] = [];
    let prevHash: string | undefined;
    for (let i = 0; i < length; i++) {
      const event = buildAuditEvent(baseInput, prevHash);
      events.push(event);
      prevHash = event.hash;
    }
    return events;
  }

  it("returns valid for an empty chain", () => {
    expect(verifyChain([])).toEqual({ valid: true });
  });

  it("returns valid for a single event", () => {
    const chain = buildChain(1);
    expect(verifyChain(chain)).toEqual({ valid: true });
  });

  it("returns valid for a correctly chained sequence", () => {
    const chain = buildChain(5);
    expect(verifyChain(chain)).toEqual({ valid: true });
  });

  it("detects a tampered event hash", () => {
    const chain = buildChain(3);
    chain[1] = { ...chain[1]!, hash: "00".repeat(32) };
    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.firstBrokenIndex).toBe(1);
  });

  it("detects a broken chain link (previousHash mismatch)", () => {
    const chain = buildChain(3);
    // Rebuild event 1 with a wrong previousHash but keep the hash valid for itself
    const broken = buildAuditEvent(baseInput, "deadbeef".repeat(8));
    chain[1] = broken;
    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.firstBrokenIndex).toBe(1);
  });

  it("detects tampering of content without updating hash", () => {
    const chain = buildChain(3);
    chain[2] = { ...chain[2]!, outcome: "failure" }; // change content, keep old hash
    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.firstBrokenIndex).toBe(2);
  });
});

describe("AUDIT_ACTIONS", () => {
  it("contains expected action keys", () => {
    expect(AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS).toBe("auth.login.success");
    expect(AUDIT_ACTIONS.AGENT_RUN_START).toBe("agent.run.start");
    expect(AUDIT_ACTIONS.SKILL_INSTALLED).toBe("skill.installed");
    expect(AUDIT_ACTIONS.CONFIG_UPDATED).toBe("config.updated");
    expect(AUDIT_ACTIONS.GATEWAY_START).toBe("system.gateway.start");
  });

  it("all values are non-empty strings", () => {
    for (const [key, val] of Object.entries(AUDIT_ACTIONS)) {
      expect(typeof val, `AUDIT_ACTIONS.${key}`).toBe("string");
      expect((val as string).length, `AUDIT_ACTIONS.${key}`).toBeGreaterThan(0);
    }
  });
});
