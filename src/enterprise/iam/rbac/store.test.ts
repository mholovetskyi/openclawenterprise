import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryRBACStore } from "./store.js";
import type { Role, User, Group, AgentIdentity } from "./model.js";

function makeRole(id: string): Role {
  return {
    id,
    name: `Role ${id}`,
    permissions: [`${id}.read`],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function makeUser(id: string, tenantId?: string): User {
  return {
    id,
    email: `${id}@example.com`,
    roles: [],
    groups: [],
    enabled: true,
    tenantId,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function makeGroup(id: string, tenantId?: string): Group {
  return {
    id,
    name: `Group ${id}`,
    roles: [],
    members: [],
    tenantId,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function makeAgent(id: string, tenantId?: string, apiKeyHash?: string): AgentIdentity {
  return {
    id,
    name: `Agent ${id}`,
    roles: [],
    enabled: true,
    tenantId,
    apiKeyHash,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("InMemoryRBACStore — Roles", () => {
  let store: InMemoryRBACStore;
  beforeEach(() => { store = new InMemoryRBACStore(); });

  it("listRoles returns empty array initially", async () => {
    expect(await store.listRoles()).toEqual([]);
  });

  it("upsertRole and getRole", async () => {
    const role = makeRole("developer");
    await store.upsertRole(role);
    const got = await store.getRole("developer");
    expect(got).toEqual(role);
  });

  it("getRole returns null for unknown id", async () => {
    expect(await store.getRole("unknown")).toBeNull();
  });

  it("upsertRole overwrites existing role", async () => {
    await store.upsertRole(makeRole("r1"));
    const updated = { ...makeRole("r1"), name: "Updated" };
    await store.upsertRole(updated);
    expect((await store.getRole("r1"))?.name).toBe("Updated");
  });

  it("listRoles returns all upserted roles", async () => {
    await store.upsertRole(makeRole("a"));
    await store.upsertRole(makeRole("b"));
    const roles = await store.listRoles();
    expect(roles.map((r) => r.id).toSorted()).toEqual(["a", "b"]);
  });

  it("deleteRole removes the role", async () => {
    await store.upsertRole(makeRole("to-del"));
    await store.deleteRole("to-del");
    expect(await store.getRole("to-del")).toBeNull();
  });
});

describe("InMemoryRBACStore — Users", () => {
  let store: InMemoryRBACStore;
  beforeEach(() => { store = new InMemoryRBACStore(); });

  it("listUsers returns empty initially", async () => {
    expect(await store.listUsers()).toEqual([]);
  });

  it("upsertUser and getUser", async () => {
    const user = makeUser("alice");
    await store.upsertUser(user);
    expect(await store.getUser("alice")).toEqual(user);
  });

  it("getUser returns null for unknown id", async () => {
    expect(await store.getUser("nobody")).toBeNull();
  });

  it("getUserByEmail finds user by email", async () => {
    await store.upsertUser(makeUser("alice"));
    const found = await store.getUserByEmail("alice@example.com");
    expect(found?.id).toBe("alice");
  });

  it("getUserByEmail returns null for unknown email", async () => {
    expect(await store.getUserByEmail("no@one.com")).toBeNull();
  });

  it("getUserByExternalId finds user by externalId", async () => {
    const user: User = { ...makeUser("ext-user"), externalId: "saml|12345" };
    await store.upsertUser(user);
    expect((await store.getUserByExternalId("saml|12345"))?.id).toBe("ext-user");
  });

  it("getUserByChannelId finds user by channel mapping", async () => {
    const user: User = { ...makeUser("chan-user"), channelIds: { telegram: "tg-999" } };
    await store.upsertUser(user);
    expect((await store.getUserByChannelId("telegram", "tg-999"))?.id).toBe("chan-user");
  });

  it("getUserByChannelId returns null for wrong channel", async () => {
    const user: User = { ...makeUser("chan2"), channelIds: { telegram: "tg-1" } };
    await store.upsertUser(user);
    expect(await store.getUserByChannelId("slack", "tg-1")).toBeNull();
  });

  it("listUsers filters by tenantId", async () => {
    await store.upsertUser(makeUser("u1", "tenant-a"));
    await store.upsertUser(makeUser("u2", "tenant-b"));
    await store.upsertUser(makeUser("u3", "tenant-a"));
    const tenantA = await store.listUsers("tenant-a");
    expect(tenantA.map((u) => u.id).toSorted()).toEqual(["u1", "u3"]);
  });

  it("deleteUser removes user", async () => {
    await store.upsertUser(makeUser("del-user"));
    await store.deleteUser("del-user");
    expect(await store.getUser("del-user")).toBeNull();
  });
});

describe("InMemoryRBACStore — Groups", () => {
  let store: InMemoryRBACStore;
  beforeEach(() => { store = new InMemoryRBACStore(); });

  it("upsertGroup and getGroup", async () => {
    const group = makeGroup("eng");
    await store.upsertGroup(group);
    expect(await store.getGroup("eng")).toEqual(group);
  });

  it("getGroup returns null for unknown id", async () => {
    expect(await store.getGroup("?")).toBeNull();
  });

  it("listGroups filters by tenantId", async () => {
    await store.upsertGroup(makeGroup("g1", "t1"));
    await store.upsertGroup(makeGroup("g2", "t2"));
    const t1 = await store.listGroups("t1");
    expect(t1.map((g) => g.id)).toEqual(["g1"]);
  });

  it("deleteGroup removes group", async () => {
    await store.upsertGroup(makeGroup("del-g"));
    await store.deleteGroup("del-g");
    expect(await store.getGroup("del-g")).toBeNull();
  });
});

describe("InMemoryRBACStore — Agent Identities", () => {
  let store: InMemoryRBACStore;
  beforeEach(() => { store = new InMemoryRBACStore(); });

  it("upsertAgentIdentity and getAgentIdentity", async () => {
    const agent = makeAgent("bot-1");
    await store.upsertAgentIdentity(agent);
    expect(await store.getAgentIdentity("bot-1")).toEqual(agent);
  });

  it("getAgentIdentity returns null for unknown id", async () => {
    expect(await store.getAgentIdentity("?")).toBeNull();
  });

  it("getAgentIdentityByApiKeyHash finds agent by hash", async () => {
    await store.upsertAgentIdentity(makeAgent("bot-2", undefined, "hash-abc123"));
    const found = await store.getAgentIdentityByApiKeyHash("hash-abc123");
    expect(found?.id).toBe("bot-2");
  });

  it("getAgentIdentityByApiKeyHash returns null for unknown hash", async () => {
    expect(await store.getAgentIdentityByApiKeyHash("unknown-hash")).toBeNull();
  });

  it("listAgentIdentities filters by tenantId", async () => {
    await store.upsertAgentIdentity(makeAgent("a1", "t1"));
    await store.upsertAgentIdentity(makeAgent("a2", "t2"));
    const t1 = await store.listAgentIdentities("t1");
    expect(t1.map((a) => a.id)).toEqual(["a1"]);
  });

  it("deleteAgentIdentity removes agent", async () => {
    await store.upsertAgentIdentity(makeAgent("del-bot"));
    await store.deleteAgentIdentity("del-bot");
    expect(await store.getAgentIdentity("del-bot")).toBeNull();
  });
});
