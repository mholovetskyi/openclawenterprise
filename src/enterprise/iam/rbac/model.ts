/**
 * RBAC data model — users, roles, permissions, groups.
 *
 * Permission format: "resource.action" or "resource.*" or "*"
 * Examples: "agents.create", "skills.install", "config.write", "audit.read"
 */

export type Permission = string; // "resource.action" | "resource.*" | "*"

export type Role = {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  permissions: Permission[];
  /** Inherit all permissions from these roles */
  inherits?: string[];
  /** System roles cannot be modified */
  system?: boolean;
  /** Alias for system (used in gateway wire format) */
  builtIn?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Group = {
  id: string;
  name: string;
  description?: string;
  roles: string[]; // role IDs
  members: string[]; // user IDs
  tenantId?: string;
  createdAt: string;
  updatedAt: string;
};

export type User = {
  id: string;
  email?: string;
  name?: string;
  /** Direct role assignments */
  roles: string[];
  /** Group memberships */
  groups: string[];
  tenantId?: string;
  /** External IdP subject (for SAML/OIDC) */
  externalId?: string;
  /** Channel identity bindings: {"telegram": "12345", "slack": "U123"} */
  channelIds?: Record<string, string>;
  /** Alias for enabled (gateway wire format) */
  active?: boolean;
  enabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
  lastLoginAt?: string;
  lastSeenAt?: string;
  /** TOTP secret (base32, encrypted at rest) — set when MFA is enrolled */
  totpSecret?: string;
  /** Whether MFA is required for this user */
  mfaEnabled?: boolean;
  /**
   * Highest TOTP time-step already consumed for this user. Used for MFA replay
   * protection: a verification must reject any code whose step is <= this value,
   * so a code cannot be reused within its ±1 acceptance window. Set by the MFA
   * verification path once wired at the auth gate (see mfa-not-enforced hook).
   */
  lastTotpStep?: number;
  /** CIDR allowlist for this user — empty means no IP restriction */
  allowedCidrs?: string[];
};

export type AgentIdentity = {
  id: string;
  name: string;
  description?: string;
  roles: string[];
  tenantId?: string;
  /** API key hash (SHA-256 of the actual key) */
  apiKeyHash?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
};

// ── Built-in roles ─────────────────────────────────────────────────────────────

export const BUILT_IN_ROLES: readonly Role[] = [
  {
    id: "super-admin",
    name: "Super Administrator",
    description: "Full access to all resources and actions",
    permissions: ["*"],
    system: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "admin",
    name: "Administrator",
    description: "Manage agents, skills, users, and view audit logs",
    permissions: [
      "agents.*",
      "skills.*",
      "config.*",
      "users.*",
      "groups.*",
      "sessions.*",
      "channels.*",
      "audit.read",
      "health.*",
      "cron.*",
      "node.*",
    ],
    system: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "operator",
    name: "Operator",
    description: "Run agents, send messages, manage sessions",
    permissions: [
      "agents.list",
      "agents.run",
      "sessions.*",
      "send",
      "chat.*",
      "tts.*",
      "health.read",
      "status.read",
      "node.invoke",
    ],
    system: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "viewer",
    name: "Viewer",
    description: "Read-only access to status and session lists",
    permissions: [
      "agents.list",
      "sessions.list",
      "sessions.preview",
      "health.read",
      "status.read",
      "models.list",
      "skills.status",
    ],
    system: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "agent-service",
    name: "Agent Service Account",
    description: "For non-human agent identities",
    permissions: ["agent", "send", "tools.*", "sessions.read", "skills.status"],
    system: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
] as const;

// ── Permission evaluation helpers ──────────────────────────────────────────────

/**
 * Check whether a permission set grants the requested permission.
 * Supports wildcards: "agents.*" grants "agents.create", "agents.list", etc.
 * "*" grants everything.
 */
export function permissionGranted(requested: Permission, granted: readonly Permission[]): boolean {
  for (const g of granted) {
    if (g === "*") return true;
    if (g === requested) return true;
    // Wildcard suffix: "agents.*" matches "agents.create"
    if (g.endsWith(".*")) {
      const prefix = g.slice(0, -2);
      if (requested === prefix || requested.startsWith(`${prefix}.`)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Expand role inheritance to a flat list of all granted permissions.
 */
export function expandRolePermissions(
  roleIds: readonly string[],
  allRoles: readonly Role[],
  visited = new Set<string>(),
): Permission[] {
  const permissions: Permission[] = [];
  for (const roleId of roleIds) {
    if (visited.has(roleId)) continue;
    visited.add(roleId);
    const role = allRoles.find((r) => r.id === roleId);
    if (!role) continue;
    permissions.push(...role.permissions);
    if (role.inherits?.length) {
      permissions.push(...expandRolePermissions(role.inherits, allRoles, visited));
    }
  }
  return [...new Set(permissions)];
}
