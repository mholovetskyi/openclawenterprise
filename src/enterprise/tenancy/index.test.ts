import { describe, it, expect } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import {
  getTenantContext,
  runWithTenant,
  runWithTenantAsync,
  getTenantRegistry,
  DEFAULT_TENANT_CONTEXT,
  initTenancy,
  type TenantContext,
} from "./index.js";

describe("getTenantContext", () => {
  it("returns DEFAULT_TENANT_CONTEXT outside of any tenant scope", () => {
    const ctx = getTenantContext();
    expect(ctx.tenantId).toBe("default");
    expect(ctx.tenantName).toBe("Default");
  });
});

describe("DEFAULT_TENANT_CONTEXT", () => {
  it("has expected shape", () => {
    expect(DEFAULT_TENANT_CONTEXT.tenantId).toBe("default");
  });
});

describe("runWithTenant", () => {
  it("makes tenant context available inside the callback", () => {
    const ctx: TenantContext = { tenantId: "acme", tenantName: "Acme Corp" };
    let captured: TenantContext | null = null;
    runWithTenant(ctx, () => {
      captured = getTenantContext();
    });
    expect(captured!.tenantId).toBe("acme");
    expect(captured!.tenantName).toBe("Acme Corp");
  });

  it("restores outer context after callback returns", () => {
    const outer = getTenantContext().tenantId;
    runWithTenant({ tenantId: "inner" }, () => {});
    expect(getTenantContext().tenantId).toBe(outer);
  });

  it("returns the callback return value", () => {
    const result = runWithTenant({ tenantId: "t1" }, () => 42);
    expect(result).toBe(42);
  });

  it("isolates nested contexts", () => {
    let inner1: string | undefined;
    let inner2: string | undefined;

    runWithTenant({ tenantId: "outer" }, () => {
      inner1 = getTenantContext().tenantId;
      runWithTenant({ tenantId: "nested" }, () => {
        inner2 = getTenantContext().tenantId;
      });
    });

    expect(inner1).toBe("outer");
    expect(inner2).toBe("nested");
  });
});

describe("runWithTenantAsync", () => {
  it("makes tenant context available inside async callback", async () => {
    const ctx: TenantContext = { tenantId: "async-tenant" };
    const result = await runWithTenantAsync(ctx, async () => {
      await Promise.resolve(); // simulate async work
      return getTenantContext().tenantId;
    });
    expect(result).toBe("async-tenant");
  });

  it("propagates context across awaits", async () => {
    const tenantId = await runWithTenantAsync({ tenantId: "persist" }, async () => {
      await new Promise((r) => setTimeout(r, 1));
      return getTenantContext().tenantId;
    });
    expect(tenantId).toBe("persist");
  });
});

describe("TenantRegistry", () => {
  it("register and get", () => {
    const registry = getTenantRegistry();
    registry.register({
      id: "test-tenant",
      name: "Test Tenant",
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const t = registry.get("test-tenant");
    expect(t?.name).toBe("Test Tenant");
  });

  it("get returns null for unknown id", () => {
    const registry = getTenantRegistry();
    expect(registry.get("nonexistent-tenant-xyz")).toBeNull();
  });

  it("list returns all registered tenants", () => {
    const registry = getTenantRegistry();
    const before = registry.list().length;
    registry.register({
      id: "list-test-tenant",
      name: "List Test",
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(registry.list().length).toBeGreaterThanOrEqual(before + 1);
  });

  it("remove deletes a tenant", () => {
    const registry = getTenantRegistry();
    registry.register({
      id: "removable",
      name: "Removable",
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    registry.remove("removable");
    expect(registry.get("removable")).toBeNull();
  });
});

describe("initTenancy", () => {
  it("registers tenants from config and always registers default", async () => {
    const cfg = {
      enterprise: {
        enabled: true,
        tenancy: {
          enabled: true,
          tenants: [
            { id: "config-tenant-1", name: "Config T1" },
            { id: "config-tenant-2", name: "Config T2" },
          ],
        },
      },
    } as unknown as OpenClawConfig;

    const handle = await initTenancy(cfg);
    const registry = getTenantRegistry();
    expect(registry.get("config-tenant-1")?.name).toBe("Config T1");
    expect(registry.get("config-tenant-2")?.name).toBe("Config T2");
    expect(registry.get("default")).not.toBeNull();
    await handle.shutdown();
  });

  it("resolves with a shutdown function", async () => {
    const handle = await initTenancy({} as OpenClawConfig);
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });
});
