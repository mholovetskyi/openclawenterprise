/**
 * RBAC authorization engine.
 * Evaluates permission checks for users, groups, and agent identities.
 */

import {
  type Permission,
  type User,
  type Group,
  type AgentIdentity,
  BUILT_IN_ROLES,
  permissionGranted,
  expandRolePermissions,
} from "./model.js";
import type { RBACStore } from "./store.js";

export type AuthzContext = {
  /** Resolved user or agent identity */
  identity: User | AgentIdentity;
  identityType: "user" | "agent";
  /** Tenant scope for multi-tenancy checks */
  tenantId?: string;
};

export type AuthzResult =
  | { allowed: true }
  | { allowed: false; reason: string; missingPermission: Permission };

export class RBACEngine {
  constructor(private readonly store: RBACStore) {}

  /**
   * Check whether an identity has a given permission.
   */
  async can(ctx: AuthzContext, permission: Permission): Promise<AuthzResult> {
    const allRoles = [...BUILT_IN_ROLES, ...(await this.store.listRoles())];
    const groups = await this.resolveGroups(ctx);
    const roleIds = await this.resolveRoleIds(ctx, groups);
    const permissions = expandRolePermissions(roleIds, allRoles);

    if (permissionGranted(permission, permissions)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Identity "${ctx.identity.id}" does not have permission "${permission}"`,
      missingPermission: permission,
    };
  }

  /**
   * Check multiple permissions — all must be granted.
   */
  async canAll(ctx: AuthzContext, permissions: Permission[]): Promise<AuthzResult> {
    for (const perm of permissions) {
      const result = await this.can(ctx, perm);
      if (!result.allowed) return result;
    }
    return { allowed: true };
  }

  /**
   * Check multiple permissions — at least one must be granted.
   */
  async canAny(ctx: AuthzContext, permissions: Permission[]): Promise<AuthzResult> {
    const reasons: string[] = [];
    for (const perm of permissions) {
      const result = await this.can(ctx, perm);
      if (result.allowed) return { allowed: true };
      // `AuthzResult` is a discriminated union on `allowed`; the early return
      // above narrows `result` to the denied variant, which carries `reason`.
      reasons.push(result.reason);
    }
    return {
      allowed: false,
      reason: reasons.join("; "),
      missingPermission: permissions[0] ?? "",
    };
  }

  /**
   * Get all effective permissions for an identity (for caching / debugging).
   */
  async getEffectivePermissions(ctx: AuthzContext): Promise<Permission[]> {
    const allRoles = [...BUILT_IN_ROLES, ...(await this.store.listRoles())];
    const groups = await this.resolveGroups(ctx);
    const roleIds = await this.resolveRoleIds(ctx, groups);
    return expandRolePermissions(roleIds, allRoles);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async resolveGroups(ctx: AuthzContext): Promise<Group[]> {
    // Only users have group membership; agents resolve roles directly.
    if (ctx.identityType === "user") {
      // SAFETY: `identity` and `identityType` are populated together when an AuthzContext is built, so identityType === "user" guarantees identity is a User.
      const user = ctx.identity as User;
      if (user.groups?.length) {
        const groups = await Promise.all(user.groups.map((id) => this.store.getGroup(id)));
        return groups.filter((g): g is Group => g !== null);
      }
    }
    return [];
  }

  private async resolveRoleIds(ctx: AuthzContext, groups: Group[]): Promise<string[]> {
    const direct = ctx.identity.roles ?? [];
    const fromGroups = groups.flatMap((g) => g.roles);
    return [...new Set([...direct, ...fromGroups])];
  }
}

// ── Legacy scope compatibility adapter ────────────────────────────────────────
// Maps existing operator.* scopes to RBAC permissions for backwards compatibility

const LEGACY_SCOPE_TO_PERMISSIONS: Record<string, Permission[]> = {
  "operator.admin": ["*"],
  "operator.write": ["agents.run", "send", "chat.*", "sessions.*", "node.invoke", "tts.*"],
  "operator.read": [
    "agents.list",
    "sessions.list",
    "sessions.preview",
    "health.read",
    "status.read",
    "models.list",
    "config.get",
    "node.list",
  ],
  "operator.approvals": ["exec.approval.*"],
  "operator.pairing": ["device.pair.*", "node.pair.*", "device.token.*"],
};

export function legacyScopesToPermissions(scopes: readonly string[]): Permission[] {
  const perms: Permission[] = [];
  for (const scope of scopes) {
    const mapped = LEGACY_SCOPE_TO_PERMISSIONS[scope];
    if (mapped) perms.push(...mapped);
  }
  return [...new Set(perms)];
}

export function checkLegacyScopePermission(
  scopes: readonly string[],
  permission: Permission,
): AuthzResult {
  const permissions = legacyScopesToPermissions(scopes);
  if (permissionGranted(permission, permissions)) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `Scopes [${scopes.join(", ")}] do not grant "${permission}"`,
    missingPermission: permission,
  };
}
