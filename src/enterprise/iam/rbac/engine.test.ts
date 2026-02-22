import { describe, it, expect, beforeEach } from "vitest";
import { RBACEngine, legacyScopesToPermissions, checkLegacyScopePermission } from "./engine.js";
import { InMemoryRBACStore } from "./store.js";
import type { User, AgentIdentity, Role, Group } from "./model.js";

function makeUser(id: string, roles: string[], groups: string[] = []): User {
  return {
    id,
    roles,
    groups,
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function makeAgent(id: string, roles: string[]): AgentIdentity {
  return {
    id,
    name: `Agent ${id}`,
    roles,
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("RBACEngine.can", () => {
  let store: InMemoryRBACStore;
  let engine: RBACEngine;

  beforeEach(() => {
    store = new InMemoryRBACStore();
    engine = new RBACEngine(store);
  });

  it("allows access for user with 'viewer' built-in role (sessions.list)", async () => {
    const user = makeUser("alice", ["viewer"]);
    const result = await engine.can({ identity: user, identityType: "user" }, "sessions.list");
    expect(result.allowed).toBe(true);
  });

  it("denies access for viewer role on admin-only permission", async () => {
    const user = makeUser("alice", ["viewer"]);
    const result = await engine.can({ identity: user, identityType: "user" }, "users.delete");
    expect(result.allowed).toBe(false);
    expect("reason" in result && result.reason).toContain("alice");
    expect("missingPermission" in result && result.missingPermission).toBe("users.delete");
  });

  it("allows super-admin to access any permission", async () => {
    const user = makeUser("root", ["super-admin"]);
    const result = await engine.can({ identity: user, identityType: "user" }, "some.obscure.perm");
    expect(result.allowed).toBe(true);
  });

  it("allows admin to access agents.* permissions", async () => {
    const user = makeUser("mgr", ["admin"]);
    const result = await engine.can({ identity: user, identityType: "user" }, "agents.delete");
    expect(result.allowed).toBe(true);
  });

  it("works with custom roles in the store", async () => {
    const customRole: Role = {
      id: "custom-role",
      name: "Custom",
      permissions: ["widgets.read"],
      createdAt: "",
      updatedAt: "",
    };
    await store.upsertRole(customRole);
    const user = makeUser("u1", ["custom-role"]);
    const result = await engine.can({ identity: user, identityType: "user" }, "widgets.read");
    expect(result.allowed).toBe(true);
  });

  it("denies when user has no roles at all", async () => {
    const user = makeUser("nobody", []);
    const result = await engine.can({ identity: user, identityType: "user" }, "agents.list");
    expect(result.allowed).toBe(false);
  });

  it("resolves permissions from group roles", async () => {
    const group: Group = {
      id: "team-ops",
      name: "Ops Team",
      roles: ["operator"],
      members: ["user-ops"],
      createdAt: "",
      updatedAt: "",
    };
    await store.upsertGroup(group);
    const user = makeUser("user-ops", [], ["team-ops"]);
    await store.upsertUser(user);
    const result = await engine.can({ identity: user, identityType: "user" }, "sessions.list");
    expect(result.allowed).toBe(true);
  });

  it("agent identity with agent-service role can use tools.*", async () => {
    const agent = makeAgent("bot-1", ["agent-service"]);
    const result = await engine.can({ identity: agent, identityType: "agent" }, "tools.invoke");
    expect(result.allowed).toBe(true);
  });
});

describe("RBACEngine.canAll", () => {
  let engine: RBACEngine;

  beforeEach(() => {
    engine = new RBACEngine(new InMemoryRBACStore());
  });

  it("returns allowed when user has all permissions", async () => {
    const user = makeUser("u", ["admin"]);
    const result = await engine.canAll(
      { identity: user, identityType: "user" },
      ["agents.list", "agents.run"],
    );
    expect(result.allowed).toBe(true);
  });

  it("returns denied when user lacks one permission", async () => {
    const user = makeUser("u", ["viewer"]);
    const result = await engine.canAll(
      { identity: user, identityType: "user" },
      ["sessions.list", "users.delete"],
    );
    expect(result.allowed).toBe(false);
    expect("missingPermission" in result && result.missingPermission).toBe("users.delete");
  });

  it("returns allowed for empty permissions array", async () => {
    const user = makeUser("u", []);
    const result = await engine.canAll({ identity: user, identityType: "user" }, []);
    expect(result.allowed).toBe(true);
  });
});

describe("RBACEngine.canAny", () => {
  let engine: RBACEngine;

  beforeEach(() => {
    engine = new RBACEngine(new InMemoryRBACStore());
  });

  it("returns allowed when user has at least one permission", async () => {
    const user = makeUser("u", ["viewer"]); // has sessions.list but not users.delete
    const result = await engine.canAny(
      { identity: user, identityType: "user" },
      ["users.delete", "sessions.list"],
    );
    expect(result.allowed).toBe(true);
  });

  it("returns denied when user has none of the permissions", async () => {
    const user = makeUser("u", ["viewer"]);
    const result = await engine.canAny(
      { identity: user, identityType: "user" },
      ["users.delete", "config.write"],
    );
    expect(result.allowed).toBe(false);
  });
});

describe("RBACEngine.getEffectivePermissions", () => {
  it("returns all permissions from all roles", async () => {
    const engine = new RBACEngine(new InMemoryRBACStore());
    const user = makeUser("u", ["viewer", "operator"]);
    const perms = await engine.getEffectivePermissions({ identity: user, identityType: "user" });
    expect(perms).toContain("sessions.list"); // from both viewer and operator
    expect(perms).toContain("sessions.*"); // from operator
    expect(perms).toContain("health.read");
  });
});

describe("legacyScopesToPermissions", () => {
  it("maps operator.admin to ['*']", () => {
    expect(legacyScopesToPermissions(["operator.admin"])).toContain("*");
  });

  it("maps operator.write to expected permissions", () => {
    const perms = legacyScopesToPermissions(["operator.write"]);
    expect(perms).toContain("agents.run");
    expect(perms).toContain("send");
  });

  it("maps operator.read to read-only permissions", () => {
    const perms = legacyScopesToPermissions(["operator.read"]);
    expect(perms).toContain("agents.list");
    expect(perms).toContain("sessions.list");
  });

  it("combines multiple scopes", () => {
    const perms = legacyScopesToPermissions(["operator.read", "operator.approvals"]);
    expect(perms).toContain("agents.list");
    expect(perms).toContain("exec.approval.*");
  });

  it("returns empty array for unknown scopes", () => {
    expect(legacyScopesToPermissions(["unknown.scope"])).toEqual([]);
  });

  it("deduplicates permissions from overlapping scopes", () => {
    const perms = legacyScopesToPermissions(["operator.admin", "operator.write"]);
    const count = perms.filter((p) => p === "*").length;
    expect(count).toBe(1);
  });
});

describe("checkLegacyScopePermission", () => {
  it("returns allowed for scopes that grant the permission", () => {
    const result = checkLegacyScopePermission(["operator.write"], "agents.run");
    expect(result.allowed).toBe(true);
  });

  it("returns denied for scopes that don't grant the permission", () => {
    const result = checkLegacyScopePermission(["operator.read"], "agents.run");
    expect(result.allowed).toBe(false);
    expect("reason" in result && result.reason).toContain("operator.read");
  });

  it("operator.admin grants any permission", () => {
    const result = checkLegacyScopePermission(["operator.admin"], "some.custom.perm");
    expect(result.allowed).toBe(true);
  });
});
