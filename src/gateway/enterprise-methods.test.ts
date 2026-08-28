/**
 * Tests for the enterprise gateway RPC wirings (Phase B integration hooks):
 *   - gdpr-export-omits-active-sessions
 *   - session-revocation (honest outcome)
 *   - totp-replay (durable, cross-restart)
 *   - rbac-engine-never-enforced (method→permission map presence)
 *
 * The handlers resolve their dependencies through getIAMHandle()/getAuditStorage(),
 * so we mock those two module entrypoints and drive the real handler closures.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MfaService } from "../enterprise/auth/mfa.js";
import type { ActiveSession, TokenStore } from "../enterprise/auth/token-store.js";
import type { User } from "../enterprise/iam/rbac/model.js";
import { InMemoryRBACStore } from "../enterprise/iam/rbac/store.js";

type FakeHandle = {
  store: InMemoryRBACStore;
  tokens: TokenStore | null;
  rbac: unknown;
};

let iamHandle: FakeHandle | null = null;
let auditStorage: unknown = null;

vi.mock("../enterprise/iam/index.js", () => ({
  getIAMHandle: () => iamHandle,
}));
vi.mock("../enterprise/audit/logger.js", () => ({
  getAuditStorage: () => auditStorage,
}));

// Imported after the mocks are registered.
const { enterpriseHandlers, ENTERPRISE_METHOD_PERMISSIONS } =
  await import("./enterprise-methods.js");

function stepNow(): number {
  return Math.floor(Date.now() / 1000 / 30);
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "alice",
    email: "alice@example.com",
    name: "Alice",
    roles: ["viewer"],
    groups: [],
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

type Response = { ok: boolean; payload?: unknown; error?: unknown };

async function invoke(method: string, params: Record<string, unknown>): Promise<Response> {
  let result: Response | undefined;
  const respond = (ok: boolean, payload?: unknown, error?: unknown) => {
    result = { ok, payload, error };
  };
  await enterpriseHandlers[method]!({ params, respond } as never);
  if (!result) throw new Error(`handler ${method} did not respond`);
  return result;
}

beforeEach(() => {
  iamHandle = null;
  auditStorage = null;
});

describe("enterprise.gdpr.export — active sessions (HOOK gdpr-export-omits-active-sessions)", () => {
  it("includes the user's active sessions from the token store", async () => {
    const store = new InMemoryRBACStore();
    await store.upsertUser(makeUser());
    const session: ActiveSession = {
      jti: "sess-1",
      subjectId: "alice",
      issuedAt: 1,
      expiresAt: 9_999_999_999,
    };
    const tokens = {
      listActiveSessions: (id: string) => (id === "alice" ? [session] : []),
    } as unknown as TokenStore;
    iamHandle = { store, tokens, rbac: {} };

    const res = await invoke("enterprise.gdpr.export", { userId: "alice" });

    expect(res.ok).toBe(true);
    const data = (res.payload as { data: { activeSessions: unknown[] } }).data;
    expect(data.activeSessions).toHaveLength(1);
    expect((data.activeSessions[0] as ActiveSession).jti).toBe("sess-1");
  });
});

describe("enterprise.sessions.revoke — honest outcome (HOOK session-revocation)", () => {
  function fakeTokens(revoked: string[]): TokenStore {
    return {
      listActiveSessions: (id: string): ActiveSession[] =>
        id === "alice"
          ? [{ jti: "live", subjectId: id, issuedAt: 1, expiresAt: 9_999_999_999 }]
          : [],
      revokeRefreshToken: (jti: string) => {
        revoked.push(jti);
      },
      revokeAllForSubject: (_id: string): number => 3,
    } as unknown as TokenStore;
  }

  it("revokes and reports 1 when (subjectId, jti) names a live session", async () => {
    const revoked: string[] = [];
    iamHandle = { store: new InMemoryRBACStore(), tokens: fakeTokens(revoked), rbac: {} };

    const res = await invoke("enterprise.sessions.revoke", { jti: "live", subjectId: "alice" });

    expect(res.ok).toBe(true);
    expect((res.payload as { revoked: number }).revoked).toBe(1);
    expect(revoked).toEqual(["live"]);
  });

  it("reports 0 and does NOT revoke when the jti is not a live session for the subject", async () => {
    const revoked: string[] = [];
    iamHandle = { store: new InMemoryRBACStore(), tokens: fakeTokens(revoked), rbac: {} };

    const res = await invoke("enterprise.sessions.revoke", { jti: "ghost", subjectId: "alice" });

    expect(res.ok).toBe(true);
    expect((res.payload as { revoked: number }).revoked).toBe(0);
    expect(revoked).toEqual([]);
  });

  it("reports the real count from revokeAllForSubject for a subject-wide revoke", async () => {
    const revoked: string[] = [];
    iamHandle = { store: new InMemoryRBACStore(), tokens: fakeTokens(revoked), rbac: {} };

    const res = await invoke("enterprise.sessions.revoke", { subjectId: "alice" });

    expect((res.payload as { revoked: number }).revoked).toBe(3);
  });

  it("reports 0 when no token store is configured", async () => {
    iamHandle = { store: new InMemoryRBACStore(), tokens: null, rbac: {} };
    const res = await invoke("enterprise.sessions.revoke", { jti: "x", subjectId: "alice" });
    expect((res.payload as { revoked: number }).revoked).toBe(0);
  });
});

describe("enterprise.mfa.verify — durable replay protection (HOOK totp-replay)", () => {
  it("accepts a fresh valid code and persists lastTotpStep", async () => {
    const store = new InMemoryRBACStore();
    const { secret } = MfaService.generateEnrollment("alice");
    await store.upsertUser(makeUser({ totpSecret: secret, mfaEnabled: true }));
    iamHandle = { store, tokens: null, rbac: {} };

    const code = MfaService.generate(secret);
    const res = await invoke("enterprise.mfa.verify", { userId: "alice", code });

    expect((res.payload as { ok: boolean }).ok).toBe(true);
    const updated = await store.getUser("alice");
    expect(updated?.lastTotpStep).toBe(stepNow());
  });

  it("rejects a code whose step was already consumed, independent of in-process state", async () => {
    const store = new InMemoryRBACStore();
    const { secret } = MfaService.generateEnrollment("alice");
    // lastTotpStep set in the future simulates a step already consumed on another
    // node / before a restart; the code never reaches MfaService.verify.
    await store.upsertUser(
      makeUser({ totpSecret: secret, mfaEnabled: true, lastTotpStep: stepNow() + 100 }),
    );
    iamHandle = { store, tokens: null, rbac: {} };

    const code = MfaService.generate(secret);
    const res = await invoke("enterprise.mfa.verify", { userId: "alice", code });

    expect((res.payload as { ok: boolean }).ok).toBe(false);
  });
});

describe("enterprise.mfa.confirm-enroll — durable replay protection (HOOK totp-replay)", () => {
  it("confirms enrollment with a fresh code and records secret + lastTotpStep", async () => {
    const store = new InMemoryRBACStore();
    await store.upsertUser(makeUser());
    iamHandle = { store, tokens: null, rbac: {} };
    const { secret } = MfaService.generateEnrollment("alice");
    const code = MfaService.generate(secret);

    const res = await invoke("enterprise.mfa.confirm-enroll", { userId: "alice", secret, code });

    expect(res.ok).toBe(true);
    const updated = await store.getUser("alice");
    expect(updated?.mfaEnabled).toBe(true);
    expect(updated?.totpSecret).toBe(secret);
    expect(updated?.lastTotpStep).toBe(stepNow());
  });

  it("rejects confirmation when the step was already consumed", async () => {
    const store = new InMemoryRBACStore();
    await store.upsertUser(makeUser({ lastTotpStep: stepNow() + 100 }));
    iamHandle = { store, tokens: null, rbac: {} };
    const { secret } = MfaService.generateEnrollment("alice");
    const code = MfaService.generate(secret);

    const res = await invoke("enterprise.mfa.confirm-enroll", { userId: "alice", secret, code });

    expect(res.ok).toBe(false);
    expect(String((res.error as { message?: string }).message)).toContain("already used");
  });
});

describe("ENTERPRISE_METHOD_PERMISSIONS map (HOOK rbac-engine-never-enforced)", () => {
  it("maps every registered enterprise handler to a required permission", () => {
    for (const method of Object.keys(enterpriseHandlers)) {
      expect(ENTERPRISE_METHOD_PERMISSIONS[method]).toBeTruthy();
    }
  });

  it("uses the documented resource.action permissions", () => {
    expect(ENTERPRISE_METHOD_PERMISSIONS["enterprise.users.upsert"]).toBe("users.write");
    expect(ENTERPRISE_METHOD_PERMISSIONS["enterprise.users.delete"]).toBe("users.delete");
    expect(ENTERPRISE_METHOD_PERMISSIONS["enterprise.audit.query"]).toBe("audit.read");
    expect(ENTERPRISE_METHOD_PERMISSIONS["enterprise.gdpr.erase"]).toBe("gdpr.erase");
  });
});
