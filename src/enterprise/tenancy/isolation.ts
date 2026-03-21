/**
 * Multi-tenant data isolation enforcement.
 *
 * Wraps any RBACStore and AuditStorage to enforce tenant-scoped queries
 * at the storage layer — not at the application layer.
 *
 * When tenant context is set (via AsyncLocalStorage), all reads and writes
 * are automatically scoped to the current tenant. Cross-tenant access
 * requires explicit use of the unscoped (admin) store.
 *
 * Usage:
 *   // At startup, wrap the stores with tenant enforcement
 *   const scopedStore = createTenantScopedRBACStore(rawStore, getTenantContext);
 *   const scopedAudit = createTenantScopedAuditStorage(rawAudit, getTenantContext);
 *
 *   // In tenant request context (AsyncLocalStorage active):
 *   const users = await scopedStore.listUsers(); // implicitly filtered to current tenant
 *
 *   // As admin with no tenant context:
 *   const allUsers = await rawStore.listUsers(); // returns all tenants
 */

import type { RBACStore } from "../iam/rbac/store.js";
import type { AuditStorage, AuditQueryOptions } from "../audit/storage/sqlite.js";
import type { AuditEvent } from "../audit/schema.js";
import { getTenantContext } from "./index.js";

// ── Tenant-scoped RBAC store ───────────────────────────────────────────────────

export function createTenantScopedRBACStore(store: RBACStore): RBACStore {
  function currentTenantId(): string | undefined {
    return getTenantContext()?.tenantId;
  }

  function assertNotCrossTenant(tenantId: string | undefined, method: string): void {
    const current = currentTenantId();
    if (current && tenantId && tenantId !== current) {
      throw Object.assign(
        new Error(
          `Tenant isolation violation: ${method} attempted cross-tenant access ` +
            `(current=${current}, requested=${tenantId})`,
        ),
        { code: "TENANT_ISOLATION_VIOLATION" },
      );
    }
  }

  return {
    // ── Roles (global — not tenant-scoped) ────────────────────────────────────
    listRoles: () => store.listRoles(),
    getRole: (id) => store.getRole(id),
    upsertRole: (role) => store.upsertRole(role),
    deleteRole: (id) => store.deleteRole(id),

    // ── Users (tenant-scoped) ─────────────────────────────────────────────────
    listUsers(tenantId?: string) {
      const effective = tenantId ?? currentTenantId();
      return store.listUsers(effective);
    },

    async getUser(id) {
      const user = await store.getUser(id);
      const current = currentTenantId();
      if (user && current && user.tenantId && user.tenantId !== current) {
        return null; // Return null rather than throw — prevents user enumeration
      }
      return user;
    },

    async getUserByEmail(email) {
      const user = await store.getUserByEmail(email);
      const current = currentTenantId();
      if (user && current && user.tenantId && user.tenantId !== current) {return null;}
      return user;
    },

    async getUserByExternalId(externalId) {
      const user = await store.getUserByExternalId(externalId);
      const current = currentTenantId();
      if (user && current && user.tenantId && user.tenantId !== current) {return null;}
      return user;
    },

    async getUserByChannelId(channel, channelUserId) {
      const user = await store.getUserByChannelId(channel, channelUserId);
      const current = currentTenantId();
      if (user && current && user.tenantId && user.tenantId !== current) {return null;}
      return user;
    },

    async upsertUser(user) {
      assertNotCrossTenant(user.tenantId, "upsertUser");
      // Auto-stamp tenant ID if in tenant context
      const current = currentTenantId();
      if (current && !user.tenantId) {
        return store.upsertUser({ ...user, tenantId: current });
      }
      return store.upsertUser(user);
    },

    async deleteUser(id) {
      const current = currentTenantId();
      if (current) {
        const user = await store.getUser(id);
        if (user && user.tenantId && user.tenantId !== current) {
          throw Object.assign(
            new Error(`Tenant isolation: cannot delete user from another tenant`),
            { code: "TENANT_ISOLATION_VIOLATION" },
          );
        }
      }
      return store.deleteUser(id);
    },

    // ── Groups (tenant-scoped) ────────────────────────────────────────────────
    listGroups(tenantId?: string) {
      const effective = tenantId ?? currentTenantId();
      return store.listGroups(effective);
    },

    async getGroup(id) {
      const group = await store.getGroup(id);
      const current = currentTenantId();
      if (group && current && group.tenantId && group.tenantId !== current) {return null;}
      return group;
    },

    async upsertGroup(group) {
      assertNotCrossTenant(group.tenantId, "upsertGroup");
      const current = currentTenantId();
      if (current && !group.tenantId) {
        return store.upsertGroup({ ...group, tenantId: current });
      }
      return store.upsertGroup(group);
    },

    async deleteGroup(id) {
      const current = currentTenantId();
      if (current) {
        const group = await store.getGroup(id);
        if (group && group.tenantId && group.tenantId !== current) {
          throw Object.assign(
            new Error(`Tenant isolation: cannot delete group from another tenant`),
            { code: "TENANT_ISOLATION_VIOLATION" },
          );
        }
      }
      return store.deleteGroup(id);
    },

    // ── Agent identities (tenant-scoped) ──────────────────────────────────────
    listAgentIdentities(tenantId?: string) {
      const effective = tenantId ?? currentTenantId();
      return store.listAgentIdentities(effective);
    },

    async getAgentIdentity(id) {
      const agent = await store.getAgentIdentity(id);
      const current = currentTenantId();
      if (agent && current && agent.tenantId && agent.tenantId !== current) {return null;}
      return agent;
    },

    async getAgentIdentityByApiKeyHash(hash) {
      const agent = await store.getAgentIdentityByApiKeyHash(hash);
      const current = currentTenantId();
      if (agent && current && agent.tenantId && agent.tenantId !== current) {return null;}
      return agent;
    },

    async upsertAgentIdentity(identity) {
      assertNotCrossTenant(identity.tenantId, "upsertAgentIdentity");
      const current = currentTenantId();
      if (current && !identity.tenantId) {
        return store.upsertAgentIdentity({ ...identity, tenantId: current });
      }
      return store.upsertAgentIdentity(identity);
    },

    async deleteAgentIdentity(id) {
      const current = currentTenantId();
      if (current) {
        const agent = await store.getAgentIdentity(id);
        if (agent && agent.tenantId && agent.tenantId !== current) {
          throw Object.assign(
            new Error(`Tenant isolation: cannot delete agent identity from another tenant`),
            { code: "TENANT_ISOLATION_VIOLATION" },
          );
        }
      }
      return store.deleteAgentIdentity(id);
    },
  };
}

// ── Tenant-scoped audit storage ───────────────────────────────────────────────

export function createTenantScopedAuditStorage(storage: AuditStorage): AuditStorage {
  function currentTenantId(): string | undefined {
    return getTenantContext()?.tenantId;
  }

  return {
    async append(event: AuditEvent): Promise<void> {
      // Auto-stamp tenant ID from context if not already set
      const current = currentTenantId();
      if (current && !event.actor.tenantId) {
        const stamped: AuditEvent = {
          ...event,
          actor: { ...event.actor, tenantId: current },
        };
        return storage.append(stamped);
      }
      return storage.append(event);
    },

    async query(opts: AuditQueryOptions) {
      // Enforce tenant filter — override any provided tenantId with the current one
      const current = currentTenantId();
      const effectiveOpts: AuditQueryOptions = current
        ? { ...opts, tenantId: current }
        : opts;
      return storage.query(effectiveOpts);
    },

    getLastHash: () => storage.getLastHash(),
    count: () => storage.count(),
    shutdown: () => storage.shutdown(),

    anonymizeActor: storage.anonymizeActor
      ? (actorId, pseudonym) => storage.anonymizeActor!(actorId, pseudonym)
      : undefined,
  };
}
