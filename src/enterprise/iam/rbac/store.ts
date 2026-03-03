/**
 * RBAC storage interface + SQLite implementation.
 */

import type { Role, User, Group, AgentIdentity } from "./model.js";

export interface RBACStore {
  // Roles
  listRoles(): Promise<Role[]>;
  getRole(id: string): Promise<Role | null>;
  upsertRole(role: Role): Promise<void>;
  deleteRole(id: string): Promise<void>;

  // Users
  listUsers(tenantId?: string): Promise<User[]>;
  getUser(id: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  getUserByExternalId(externalId: string): Promise<User | null>;
  getUserByChannelId(channel: string, channelUserId: string): Promise<User | null>;
  upsertUser(user: User): Promise<void>;
  deleteUser(id: string): Promise<void>;

  // Groups
  listGroups(tenantId?: string): Promise<Group[]>;
  getGroup(id: string): Promise<Group | null>;
  upsertGroup(group: Group): Promise<void>;
  deleteGroup(id: string): Promise<void>;

  // Agent identities
  listAgentIdentities(tenantId?: string): Promise<AgentIdentity[]>;
  getAgentIdentity(id: string): Promise<AgentIdentity | null>;
  getAgentIdentityByApiKeyHash(hash: string): Promise<AgentIdentity | null>;
  upsertAgentIdentity(identity: AgentIdentity): Promise<void>;
  deleteAgentIdentity(id: string): Promise<void>;
}

// ── In-memory implementation (default for single-node / testing) ───────────────

export class InMemoryRBACStore implements RBACStore {
  private roles = new Map<string, Role>();
  private users = new Map<string, User>();
  private groups = new Map<string, Group>();
  private agents = new Map<string, AgentIdentity>();

  async listRoles(): Promise<Role[]> {
    return [...this.roles.values()];
  }
  async getRole(id: string): Promise<Role | null> {
    return this.roles.get(id) ?? null;
  }
  async upsertRole(role: Role): Promise<void> {
    this.roles.set(role.id, role);
  }
  async deleteRole(id: string): Promise<void> {
    this.roles.delete(id);
  }

  async listUsers(tenantId?: string): Promise<User[]> {
    const all = [...this.users.values()];
    return tenantId ? all.filter((u) => u.tenantId === tenantId) : all;
  }
  async getUser(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }
  async getUserByEmail(email: string): Promise<User | null> {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }
  async getUserByExternalId(externalId: string): Promise<User | null> {
    return [...this.users.values()].find((u) => u.externalId === externalId) ?? null;
  }
  async getUserByChannelId(channel: string, channelUserId: string): Promise<User | null> {
    return [...this.users.values()].find((u) => u.channelIds?.[channel] === channelUserId) ?? null;
  }
  async upsertUser(user: User): Promise<void> {
    this.users.set(user.id, user);
  }
  async deleteUser(id: string): Promise<void> {
    this.users.delete(id);
  }

  async listGroups(tenantId?: string): Promise<Group[]> {
    const all = [...this.groups.values()];
    return tenantId ? all.filter((g) => g.tenantId === tenantId) : all;
  }
  async getGroup(id: string): Promise<Group | null> {
    return this.groups.get(id) ?? null;
  }
  async upsertGroup(group: Group): Promise<void> {
    this.groups.set(group.id, group);
  }
  async deleteGroup(id: string): Promise<void> {
    this.groups.delete(id);
  }

  async listAgentIdentities(tenantId?: string): Promise<AgentIdentity[]> {
    const all = [...this.agents.values()];
    return tenantId ? all.filter((a) => a.tenantId === tenantId) : all;
  }
  async getAgentIdentity(id: string): Promise<AgentIdentity | null> {
    return this.agents.get(id) ?? null;
  }
  async getAgentIdentityByApiKeyHash(hash: string): Promise<AgentIdentity | null> {
    return [...this.agents.values()].find((a) => a.apiKeyHash === hash) ?? null;
  }
  async upsertAgentIdentity(identity: AgentIdentity): Promise<void> {
    this.agents.set(identity.id, identity);
  }
  async deleteAgentIdentity(id: string): Promise<void> {
    this.agents.delete(id);
  }
}
