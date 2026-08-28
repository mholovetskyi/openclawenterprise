import { describe, it, expect } from "vitest";
import type { User, AgentIdentity } from "../iam/rbac/model.js";
import { InMemoryRBACStore } from "../iam/rbac/store.js";
import { runWithTenantAsync } from "./index.js";
import { createTenantScopedRBACStore } from "./isolation.js";

function user(id: string, tenantId?: string): User {
  return { id, roles: [], groups: [], ...(tenantId ? { tenantId } : {}) };
}

function agent(id: string, hash: string, tenantId?: string): AgentIdentity {
  return {
    id,
    name: id,
    roles: [],
    apiKeyHash: hash,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...(tenantId ? { tenantId } : {}),
  };
}

async function withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return runWithTenantAsync({ tenantId }, fn);
}

describe("tenant isolation: untenanted record leak (fail closed)", () => {
  it("hides an untenanted user from an active (non-default) tenant context", async () => {
    const raw = new InMemoryRBACStore();
    await raw.upsertUser(user("legacy-admin")); // no tenantId
    const scoped = createTenantScopedRBACStore(raw);

    const leaked = await withTenant("acme", () => scoped.getUser("legacy-admin"));
    expect(leaked).toBeNull();
  });

  it("hides an untenanted API-key identity from an active tenant (no cross-tenant auth)", async () => {
    const raw = new InMemoryRBACStore();
    await raw.upsertAgentIdentity(agent("legacy-agent", "hash-xyz")); // no tenantId
    const scoped = createTenantScopedRBACStore(raw);

    const leaked = await withTenant("acme", () => scoped.getAgentIdentityByApiKeyHash("hash-xyz"));
    expect(leaked).toBeNull();
  });

  it("still returns untenanted records in single-tenant / default mode", async () => {
    const raw = new InMemoryRBACStore();
    await raw.upsertUser(user("legacy-admin"));
    const scoped = createTenantScopedRBACStore(raw);

    // No tenant context active => default => untenanted records remain visible.
    const visible = await scoped.getUser("legacy-admin");
    expect(visible?.id).toBe("legacy-admin");
  });

  it("returns a record whose tenantId matches the active tenant", async () => {
    const raw = new InMemoryRBACStore();
    await raw.upsertUser(user("acme-user", "acme"));
    const scoped = createTenantScopedRBACStore(raw);

    const seen = await withTenant("acme", () => scoped.getUser("acme-user"));
    expect(seen?.id).toBe("acme-user");

    const crossTenant = await withTenant("other", () => scoped.getUser("acme-user"));
    expect(crossTenant).toBeNull();
  });

  it("refuses to delete an untenanted record from within an active tenant", async () => {
    const raw = new InMemoryRBACStore();
    await raw.upsertUser(user("legacy-admin"));
    const scoped = createTenantScopedRBACStore(raw);

    await expect(withTenant("acme", () => scoped.deleteUser("legacy-admin"))).rejects.toThrow(
      /isolation/i,
    );
  });
});
