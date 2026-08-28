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

export type TenantRateLimits = {
  requestsPerMinute?: number;
};

export type Tenant = {
  id: string;
  name: string;
  description?: string;
  limits?: TenantLimits;
  rateLimits?: TenantRateLimits;
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

// ── Limit enforcement helpers ────────────────────────────────────────────────

/**
 * Enforce a tenant's `limits.allowedModels` allowlist.
 *
 * Returns true when the model may be used by the given tenant context:
 *  - no context / no limits / empty (or absent) allowedModels => unrestricted.
 *  - otherwise the model must appear in the allowlist.
 *
 * Callers (model-selection / resolution) should reject the request when this
 * returns false. Kept as a pure, exported function so the enforcement site can
 * live on the request path without importing selection internals here.
 */
export function isModelAllowedForTenant(
  model: string,
  ctx: TenantContext = getTenantContext(),
): boolean {
  const allowed = ctx.limits?.allowedModels;
  if (!allowed || allowed.length === 0) return true;
  return allowed.includes(model);
}

/**
 * Look up a registered tenant's configured requests-per-minute rate limit, if
 * any. Returns undefined when unset (no per-tenant admission limit configured).
 * The enforcement site (request ingress) is responsible for keying a token
 * bucket on the tenant id using this value.
 */
export function getTenantRequestsPerMinute(tenantId: string): number | undefined {
  const tenant = registry.get(tenantId);
  const rpm = tenant?.rateLimits?.requestsPerMinute;
  return typeof rpm === "number" && rpm > 0 ? rpm : undefined;
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
      rateLimits: t.rateLimits,
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
