import { describe, it, expect, beforeEach } from "vitest";
import type { TokenStore } from "../auth/token-store.js";
import { gdprExportUser, gdprEraseUser } from "./gdpr.js";
import type { User, Group } from "./rbac/model.js";
import { InMemoryRBACStore } from "./rbac/store.js";

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

function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: "g1",
    name: "Group 1",
    roles: [],
    members: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("gdprExportUser — secret redaction", () => {
  let store: InMemoryRBACStore;

  beforeEach(() => {
    store = new InMemoryRBACStore();
  });

  it("omits totpSecret from the export profile for an MFA-enrolled user", async () => {
    await store.upsertUser(makeUser({ mfaEnabled: true, totpSecret: "JBSWY3DPEHPK3PXP" }));

    const result = await gdprExportUser("alice", store);
    const profile = result.profile as Record<string, unknown>;

    expect(profile).not.toHaveProperty("totpSecret");
    // Sanity: whole payload must never contain the seed anywhere.
    expect(JSON.stringify(result)).not.toContain("JBSWY3DPEHPK3PXP");
    // Non-secret fields are still exported (portability requirement).
    expect(profile.email).toBe("alice@example.com");
    expect(profile.mfaEnabled).toBe(true);
  });

  it("returns null profile when the user does not exist", async () => {
    const result = await gdprExportUser("ghost", store);
    expect(result.profile).toBeNull();
  });

  it("includes active sessions when a tokens store is provided", async () => {
    await store.upsertUser(makeUser());
    const sessions = [{ jti: "s1", subjectId: "alice" }];
    // SAFETY: test double implementing only the TokenStore methods gdprExportUser calls.
    const tokens = {
      listActiveSessions: (subjectId: string) => (subjectId === "alice" ? sessions : []),
    } as unknown as TokenStore;

    const result = await gdprExportUser("alice", store, undefined, tokens);
    expect(result.activeSessions).toEqual(sessions);
  });
});

describe("gdprEraseUser — PII purge across owned stores", () => {
  let store: InMemoryRBACStore;

  beforeEach(() => {
    store = new InMemoryRBACStore();
  });

  it("removes the erased user from every group's membership and reports the count", async () => {
    await store.upsertUser(makeUser({ groups: ["g1", "g2"] }));
    await store.upsertGroup(makeGroup({ id: "g1", members: ["alice", "bob"] }));
    await store.upsertGroup(makeGroup({ id: "g2", members: ["alice"] }));
    await store.upsertGroup(makeGroup({ id: "g3", members: ["bob"] }));

    const result = await gdprEraseUser("alice", store);

    expect(result.ok).toBe(true);
    expect(result.groupsUpdated).toBe(2);
    expect((await store.getGroup("g1"))?.members).toEqual(["bob"]);
    expect((await store.getGroup("g2"))?.members).toEqual([]);
    expect((await store.getGroup("g3"))?.members).toEqual(["bob"]);
    // User row itself is deleted.
    expect(await store.getUser("alice")).toBeNull();
  });

  it("revokes active sessions via the tokens store", async () => {
    await store.upsertUser(makeUser());
    // SAFETY: test double implementing only the TokenStore methods gdprEraseUser calls.
    const tokens = {
      revokeAllForSubject: (subjectId: string) => (subjectId === "alice" ? 3 : 0),
    } as unknown as TokenStore;

    const result = await gdprEraseUser("alice", store, tokens);
    expect(result.sessionsRevoked).toBe(3);
  });
});
