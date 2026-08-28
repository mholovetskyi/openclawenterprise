import { describe, it, expect } from "vitest";
import {
  buildAuditEvent,
  verifyEventHash,
  verifyChain,
  verifyActorCommitment,
  anonymizeEventActor,
  computeActorCommitment,
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
    let prevSeq: number | undefined;
    for (let i = 0; i < length; i++) {
      const event = buildAuditEvent(baseInput, prevHash, prevSeq);
      events.push(event);
      prevHash = event.hash;
      prevSeq = event.seq;
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

  it("detects prefix truncation (oldest events deleted)", () => {
    // Deleting the oldest K events leaves a new first event whose previousHash
    // points at a now-deleted predecessor rather than the genesis sentinel.
    const chain = buildChain(5);
    const truncated = chain.slice(2); // drop the two oldest
    const result = verifyChain(truncated);
    expect(result.valid).toBe(false);
    expect(result.firstBrokenIndex).toBe(0);
  });

  it("detects suffix truncation via an anchored count+head", () => {
    const chain = buildChain(5);
    const head = chain[chain.length - 1]!;
    const anchor = { expectedCount: 5, expectedHead: head.hash };
    // Full chain against the anchor is valid.
    expect(verifyChain(chain, anchor)).toEqual({ valid: true });
    // Deleting the newest events still links cleanly but fails the anchor.
    const truncated = chain.slice(0, 3);
    const result = verifyChain(truncated, anchor);
    expect(result.valid).toBe(false);
  });

  it("detects a sequence gap even when hashes are individually valid", () => {
    const chain = buildChain(4);
    // Re-key event 2 onto event 0 with a bumped seq gap: build a fresh event
    // that links correctly by hash but skips a seq number.
    const forged = buildAuditEvent(baseInput, chain[1]!.hash, chain[1]!.seq! + 5);
    chain[2] = forged;
    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.firstBrokenIndex).toBe(2);
  });

  it("accepts an anchored full chain from genesis", () => {
    const chain = buildChain(3);
    const result = verifyChain(chain, {
      genesisPreviousHash: undefined,
      expectedFirstSeq: 0,
      expectedCount: 3,
      expectedHead: chain[2]!.hash,
    });
    expect(result).toEqual({ valid: true });
  });
});

describe("GDPR erasure hash stability", () => {
  const piiInput: AuditEventInput = {
    actor: {
      type: "user",
      id: "alice@corp.example",
      name: "Alice",
      email: "alice@corp.example",
      ip: "203.0.113.7",
      sessionId: "sess-xyz",
      channelUserId: "slack-U123",
    },
    action: AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS,
    category: "auth",
    outcome: "success",
  };

  it("anonymizeEventActor keeps the event hash valid (chain stays intact)", () => {
    const event = buildAuditEvent(piiInput);
    expect(verifyEventHash(event)).toBe(true);

    const erased = anonymizeEventActor(event, "[erased-abc123]");
    // Hash is unchanged because erasable PII is excluded from the pre-image.
    expect(erased.hash).toBe(event.hash);
    expect(verifyEventHash(erased)).toBe(true);
  });

  it("strips all erasable actor PII from the erased event", () => {
    const event = buildAuditEvent(piiInput);
    const erased = anonymizeEventActor(event, "[erased-abc123]");
    expect(erased.actor.id).toBe("[erased-abc123]");
    expect(erased.actor.name).toBeUndefined();
    expect(erased.actor.email).toBeUndefined();
    expect(erased.actor.ip).toBeUndefined();
    expect(erased.actor.sessionId).toBeUndefined();
    expect(erased.actor.channelUserId).toBeUndefined();
    expect(erased.erased).toBe(true);
  });

  it("keeps verifyChain valid across an erasure in the middle of the chain", () => {
    let prevHash: string | undefined;
    let prevSeq: number | undefined;
    const chain: AuditEvent[] = [];
    for (let i = 0; i < 4; i++) {
      const e = buildAuditEvent(piiInput, prevHash, prevSeq);
      chain.push(e);
      prevHash = e.hash;
      prevSeq = e.seq;
    }
    expect(verifyChain(chain)).toEqual({ valid: true });

    chain[1] = anonymizeEventActor(chain[1]!, "[erased-abc123]");
    // Erasure must be indistinguishable from an untampered chain to verifyChain.
    expect(verifyChain(chain)).toEqual({ valid: true });
  });

  it("actor commitment detects raw-PII tampering on a live (non-erased) event", () => {
    const event = buildAuditEvent(piiInput);
    expect(verifyActorCommitment(event)).toBe(true);

    // Attacker swaps the displayed actor.id without touching the commitment.
    const tampered: AuditEvent = { ...event, actor: { ...event.actor, id: "mallory" } };
    expect(verifyActorCommitment(tampered)).toBe(false);
  });

  it("actor commitment binds the original identity even after erasure", () => {
    const event = buildAuditEvent(piiInput);
    const commitment = computeActorCommitment(piiInput.actor);
    const erased = anonymizeEventActor(event, "[erased-abc123]");
    // The commitment (in the pre-image) is preserved and still fingerprints the
    // original PII; the erased event skips the live re-derivation check.
    expect(erased.actorCommitment).toBe(commitment);
    expect(verifyActorCommitment(erased)).toBe(true);
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
