import { describe, it, expect } from "vitest";
import {
  permissionGranted,
  expandRolePermissions,
  BUILT_IN_ROLES,
  type Role,
} from "./model.js";

describe("permissionGranted", () => {
  it("returns true for exact match", () => {
    expect(permissionGranted("agents.create", ["agents.create"])).toBe(true);
  });

  it("returns true for '*' wildcard (super-admin)", () => {
    expect(permissionGranted("anything.at.all", ["*"])).toBe(true);
  });

  it("returns true for resource.* wildcard", () => {
    expect(permissionGranted("agents.create", ["agents.*"])).toBe(true);
    expect(permissionGranted("agents.list", ["agents.*"])).toBe(true);
    expect(permissionGranted("agents.delete", ["agents.*"])).toBe(true);
  });

  it("resource.* also matches the bare resource name", () => {
    expect(permissionGranted("agents", ["agents.*"])).toBe(true);
  });

  it("resource.* does not match a different resource", () => {
    expect(permissionGranted("skills.install", ["agents.*"])).toBe(false);
  });

  it("returns false when no permissions match", () => {
    expect(permissionGranted("agents.create", ["sessions.read", "health.read"])).toBe(false);
  });

  it("returns false on empty granted list", () => {
    expect(permissionGranted("agents.create", [])).toBe(false);
  });

  it("does not confuse partial prefix (agents vs agent)", () => {
    expect(permissionGranted("agents.create", ["agent.*"])).toBe(false);
  });
});

describe("expandRolePermissions", () => {
  const baseRoles: Role[] = [
    {
      id: "reader",
      name: "Reader",
      permissions: ["sessions.list", "health.read"],
      createdAt: "",
      updatedAt: "",
    },
    {
      id: "writer",
      name: "Writer",
      permissions: ["sessions.write"],
      inherits: ["reader"],
      createdAt: "",
      updatedAt: "",
    },
    {
      id: "admin",
      name: "Admin",
      permissions: ["users.*"],
      inherits: ["writer"],
      createdAt: "",
      updatedAt: "",
    },
  ];

  it("returns direct permissions for a simple role", () => {
    const perms = expandRolePermissions(["reader"], baseRoles);
    expect(perms).toContain("sessions.list");
    expect(perms).toContain("health.read");
  });

  it("includes inherited permissions (one level)", () => {
    const perms = expandRolePermissions(["writer"], baseRoles);
    expect(perms).toContain("sessions.write");
    expect(perms).toContain("sessions.list");
    expect(perms).toContain("health.read");
  });

  it("includes inherited permissions (two levels deep)", () => {
    const perms = expandRolePermissions(["admin"], baseRoles);
    expect(perms).toContain("users.*");
    expect(perms).toContain("sessions.write");
    expect(perms).toContain("sessions.list");
    expect(perms).toContain("health.read");
  });

  it("deduplicates permissions from multiple roles", () => {
    const perms = expandRolePermissions(["reader", "writer"], baseRoles);
    const count = perms.filter((p) => p === "health.read").length;
    expect(count).toBe(1);
  });

  it("handles cyclic inheritance without infinite loop", () => {
    const cyclic: Role[] = [
      {
        id: "a",
        name: "A",
        permissions: ["perm-a"],
        inherits: ["b"],
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "b",
        name: "B",
        permissions: ["perm-b"],
        inherits: ["a"],
        createdAt: "",
        updatedAt: "",
      },
    ];
    const perms = expandRolePermissions(["a"], cyclic);
    expect(perms).toContain("perm-a");
    expect(perms).toContain("perm-b");
  });

  it("returns empty array for unknown role IDs", () => {
    const perms = expandRolePermissions(["nonexistent"], baseRoles);
    expect(perms).toEqual([]);
  });

  it("returns empty array for empty roleIds", () => {
    const perms = expandRolePermissions([], baseRoles);
    expect(perms).toEqual([]);
  });
});

describe("BUILT_IN_ROLES", () => {
  it("contains the expected role IDs", () => {
    const ids = BUILT_IN_ROLES.map((r) => r.id);
    expect(ids).toContain("super-admin");
    expect(ids).toContain("admin");
    expect(ids).toContain("operator");
    expect(ids).toContain("viewer");
    expect(ids).toContain("agent-service");
  });

  it("super-admin has wildcard permission", () => {
    const sa = BUILT_IN_ROLES.find((r) => r.id === "super-admin");
    expect(sa?.permissions).toContain("*");
  });

  it("all built-in roles are marked as system=true", () => {
    for (const role of BUILT_IN_ROLES) {
      expect(role.system).toBe(true);
    }
  });

  it("admin role grants audit.read", () => {
    const admin = BUILT_IN_ROLES.find((r) => r.id === "admin");
    expect(admin?.permissions).toContain("audit.read");
  });

  it("viewer role is read-only (no write or wildcard)", () => {
    const viewer = BUILT_IN_ROLES.find((r) => r.id === "viewer");
    expect(viewer?.permissions.some((p) => p.includes("write") || p === "*")).toBe(false);
  });
});
