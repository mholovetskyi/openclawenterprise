/**
 * Multi-tenancy subsystem.
 *
 * Provides tenant isolation via AsyncLocalStorage context propagation.
 * Each tenant gets isolated: data, sessions, agents, skill registry, resource quotas.
 *
 * Activation: enterprise.tenancy.enabled: true
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { OpenClawConfig } from "../../config/config.js";

// ── Tenant context ─────────────────────────────────────────────────────────────

export type TenantLimits = {
  maxAgents?: number;
  maxSessionsPerAgent?: number;
  maxTokensPerDay?: number;
  maxSkills?: number;
  maxSandboxContainers?: number;
  allowedModels?: string[];
};

export type TenantContext = {
  tenantId: string;
  tenantName?: string;
  userId?: string;
  roles?: string[];
  limits?: TenantLimits;
};

export type Tenant = {
  id: string;
  name: string;
  description?: string;
  limits?: TenantLimits;
  config?: Partial<OpenClawConfig>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

const tenantStorage = new AsyncLocalStorage<TenantContext>();

export const DEFAULT_TENANT_CONTEXT: TenantContext = {
  tenantId: "default",
  tenantName: "Default",
};

/**
 * Get the current tenant context from AsyncLocalStorage.
 * Falls back to DEFAULT_TENANT_CONTEXT in single-user mode.
 */
export function getTenantContext(): TenantContext {
  return tenantStorage.getStore() ?? DEFAULT_TENANT_CONTEXT;
}

/**
 * Run a function within a specific tenant context.
 */
export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return tenantStorage.run(ctx, fn);
}

/**
 * Run an async function within a specific tenant context.
 */
export async function runWithTenantAsync<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run(ctx, fn);
}

// ── Tenant registry ────────────────────────────────────────────────────────────

class TenantRegistry {
  private tenants = new Map<string, Tenant>();

  register(tenant: Tenant): void {
    this.tenants.set(tenant.id, tenant);
  }

  get(id: string): Tenant | null {
    return this.tenants.get(id) ?? null;
  }

  list(): Tenant[] {
    return [...this.tenants.values()];
  }

  remove(id: string): void {
    this.tenants.delete(id);
  }
}

const registry = new TenantRegistry();

export function getTenantRegistry(): TenantRegistry {
  return registry;
}

// ── Initialization ─────────────────────────────────────────────────────────────

export type TenancyHandle = {
  shutdown: () => Promise<void>;
};

export async function initTenancy(cfg: OpenClawConfig): Promise<TenancyHandle> {
  // Register tenants from config
  const tenantsList = cfg.enterprise?.tenancy?.tenants ?? [];
  for (const t of tenantsList) {
    registry.register({
      id: t.id,
      name: t.name ?? t.id,
      description: t.description,
      limits: t.limits,
      enabled: t.enabled !== false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  // Always register the default tenant
  if (!registry.get("default")) {
    registry.register({
      id: "default",
      name: "Default",
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  return { shutdown: async () => {} };
}
