/**
 * Enterprise IAM / audit gateway RPC schemas.
 * All enterprise methods require the caller to hold the "admin" role or higher
 * (enterprise.* handlers register as aux gateway methods with the admin scope).
 */

import type { Static } from "typebox";
import { Type } from "typebox";
import { closedObject } from "../../../../packages/gateway-protocol/src/schema/closed-object.js";
import { NonEmptyString } from "../../../../packages/gateway-protocol/src/schema/primitives.js";

// ── Shared shapes ─────────────────────────────────────────────────────────────

export const RbacRoleSchema = closedObject({
  id: NonEmptyString,
  displayName: Type.String(),
  permissions: Type.Array(NonEmptyString),
  builtIn: Type.Optional(Type.Boolean()),
});

export const RbacUserSchema = closedObject({
  id: NonEmptyString,
  name: Type.Optional(Type.String()),
  email: Type.Optional(Type.String()),
  roles: Type.Array(NonEmptyString),
  groups: Type.Array(NonEmptyString),
  tenantId: Type.Optional(NonEmptyString),
  active: Type.Boolean(),
  createdAt: Type.Optional(Type.String()),
  lastSeenAt: Type.Optional(Type.String()),
  mfaEnabled: Type.Optional(Type.Boolean()),
  allowedCidrs: Type.Optional(Type.Array(Type.String())),
});

export const RbacGroupSchema = closedObject({
  id: NonEmptyString,
  displayName: Type.String(),
  roles: Type.Array(NonEmptyString),
  memberIds: Type.Array(NonEmptyString),
  tenantId: Type.Optional(NonEmptyString),
});

export const AuditEventSummarySchema = closedObject({
  id: NonEmptyString,
  timestamp: NonEmptyString,
  actorId: NonEmptyString,
  actorEmail: Type.Optional(Type.String()),
  action: NonEmptyString,
  category: NonEmptyString,
  outcome: NonEmptyString,
  resourceId: Type.Optional(Type.String()),
  resourceType: Type.Optional(Type.String()),
  tenantId: Type.Optional(Type.String()),
  errorMessage: Type.Optional(Type.String()),
  durationMs: Type.Optional(Type.Integer({ minimum: 0 })),
});

export const ActiveSessionSchema = closedObject({
  jti: NonEmptyString,
  subjectId: NonEmptyString,
  issuedAt: Type.Integer({ minimum: 0 }),
  expiresAt: Type.Integer({ minimum: 0 }),
  userAgent: Type.Optional(Type.String()),
  ipAddress: Type.Optional(Type.String()),
});

// ── Users ─────────────────────────────────────────────────────────────────────

export const EnterpriseUsersListParamsSchema = closedObject({
  tenantId: Type.Optional(NonEmptyString),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 100 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});
export const EnterpriseUsersListResultSchema = closedObject({
  users: Type.Array(RbacUserSchema),
  total: Type.Integer({ minimum: 0 }),
});

export const EnterpriseUserGetParamsSchema = closedObject({ userId: NonEmptyString });
export const EnterpriseUserGetResultSchema = RbacUserSchema;

export const EnterpriseUserUpsertParamsSchema = closedObject({
  id: NonEmptyString,
  name: Type.Optional(Type.String()),
  email: Type.Optional(Type.String()),
  roles: Type.Array(NonEmptyString),
  groups: Type.Optional(Type.Array(NonEmptyString)),
  tenantId: Type.Optional(NonEmptyString),
  active: Type.Boolean(),
  allowedCidrs: Type.Optional(Type.Array(Type.String())),
});
export const EnterpriseUserUpsertResultSchema = closedObject({ ok: Type.Literal(true) });

export const EnterpriseUserDeleteParamsSchema = closedObject({ userId: NonEmptyString });
export const EnterpriseUserDeleteResultSchema = closedObject({ ok: Type.Literal(true) });

// ── Roles ─────────────────────────────────────────────────────────────────────

export const EnterpriseRolesListParamsSchema = closedObject({});
export const EnterpriseRolesListResultSchema = closedObject({
  roles: Type.Array(RbacRoleSchema),
});

// ── Sessions ──────────────────────────────────────────────────────────────────

export const EnterpriseSessionsListParamsSchema = closedObject({ subjectId: NonEmptyString });
export const EnterpriseSessionsListResultSchema = closedObject({
  sessions: Type.Array(ActiveSessionSchema),
});

export const EnterpriseSessionRevokeParamsSchema = closedObject({
  /** Revoke a specific session. */
  jti: Type.Optional(NonEmptyString),
  /** Revoke ALL sessions for a user. */
  subjectId: Type.Optional(NonEmptyString),
});
export const EnterpriseSessionRevokeResultSchema = closedObject({
  revoked: Type.Integer({ minimum: 0 }),
});

// ── Audit ─────────────────────────────────────────────────────────────────────

export const EnterpriseAuditQueryParamsSchema = closedObject({
  actorId: Type.Optional(NonEmptyString),
  category: Type.Optional(NonEmptyString),
  action: Type.Optional(NonEmptyString),
  outcome: Type.Optional(NonEmptyString),
  tenantId: Type.Optional(NonEmptyString),
  /** ISO 8601 lower bound. */
  from: Type.Optional(NonEmptyString),
  /** ISO 8601 upper bound. */
  until: Type.Optional(NonEmptyString),
  search: Type.Optional(NonEmptyString),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});
export const EnterpriseAuditQueryResultSchema = closedObject({
  events: Type.Array(AuditEventSummarySchema),
  total: Type.Integer({ minimum: 0 }),
});

export const EnterpriseAuditExportParamsSchema = closedObject({
  format: Type.Union([Type.Literal("json"), Type.Literal("ndjson")]),
  from: Type.Optional(NonEmptyString),
  until: Type.Optional(NonEmptyString),
  tenantId: Type.Optional(NonEmptyString),
});
export const EnterpriseAuditExportResultSchema = closedObject({
  /** Download URL if returned as a file. */
  url: Type.Optional(NonEmptyString),
  /** Inline JSON/NDJSON for small exports. */
  data: Type.Optional(Type.String()),
});

// ── GDPR ──────────────────────────────────────────────────────────────────────

export const EnterpriseGdprExportParamsSchema = closedObject({ userId: NonEmptyString });
export const EnterpriseGdprExportResultSchema = closedObject({ data: Type.Unknown() });

export const EnterpriseGdprEraseParamsSchema = closedObject({ userId: NonEmptyString });
export const EnterpriseGdprEraseResultSchema = closedObject({
  ok: Type.Literal(true),
  auditEventsAnonymized: Type.Integer({ minimum: 0 }),
  sessionsRevoked: Type.Integer({ minimum: 0 }),
});

// ── MFA ───────────────────────────────────────────────────────────────────────

export const EnterpriseMfaEnrollParamsSchema = closedObject({ userId: NonEmptyString });
export const EnterpriseMfaEnrollResultSchema = closedObject({
  /** Base32 TOTP secret (show once to user). */
  secret: NonEmptyString,
  /** otpauth:// URI for QR code rendering. */
  otpauthUri: NonEmptyString,
});

export const EnterpriseMfaVerifyParamsSchema = closedObject({
  userId: NonEmptyString,
  code: NonEmptyString,
});
export const EnterpriseMfaVerifyResultSchema = closedObject({ ok: Type.Boolean() });

export const EnterpriseMfaConfirmEnrollParamsSchema = closedObject({
  userId: NonEmptyString,
  secret: NonEmptyString,
  code: NonEmptyString,
});
export const EnterpriseMfaConfirmEnrollResultSchema = closedObject({ ok: Type.Literal(true) });

export const EnterpriseMfaDisableParamsSchema = closedObject({ userId: NonEmptyString });
export const EnterpriseMfaDisableResultSchema = closedObject({ ok: Type.Literal(true) });

// ── IP allowlist ──────────────────────────────────────────────────────────────

export const EnterpriseIpAllowlistCheckParamsSchema = closedObject({
  userId: NonEmptyString,
  ipAddress: NonEmptyString,
});
export const EnterpriseIpAllowlistCheckResultSchema = closedObject({
  allowed: Type.Boolean(),
  reason: NonEmptyString,
});

// ── Wire types ────────────────────────────────────────────────────────────────
// Wire types derive directly from local schema consts, matching the upstream
// schema-module idiom in packages/gateway-protocol/src/schema/.

export type RbacRoleWire = Static<typeof RbacRoleSchema>;
export type RbacUserWire = Static<typeof RbacUserSchema>;
export type RbacGroupWire = Static<typeof RbacGroupSchema>;
export type AuditEventSummaryWire = Static<typeof AuditEventSummarySchema>;
export type ActiveSessionWire = Static<typeof ActiveSessionSchema>;
export type EnterpriseUsersListParams = Static<typeof EnterpriseUsersListParamsSchema>;
export type EnterpriseUsersListResult = Static<typeof EnterpriseUsersListResultSchema>;
export type EnterpriseUserGetParams = Static<typeof EnterpriseUserGetParamsSchema>;
export type EnterpriseUserGetResult = Static<typeof EnterpriseUserGetResultSchema>;
export type EnterpriseUserUpsertParams = Static<typeof EnterpriseUserUpsertParamsSchema>;
export type EnterpriseUserUpsertResult = Static<typeof EnterpriseUserUpsertResultSchema>;
export type EnterpriseUserDeleteParams = Static<typeof EnterpriseUserDeleteParamsSchema>;
export type EnterpriseUserDeleteResult = Static<typeof EnterpriseUserDeleteResultSchema>;
export type EnterpriseRolesListParams = Static<typeof EnterpriseRolesListParamsSchema>;
export type EnterpriseRolesListResult = Static<typeof EnterpriseRolesListResultSchema>;
export type EnterpriseSessionsListParams = Static<typeof EnterpriseSessionsListParamsSchema>;
export type EnterpriseSessionsListResult = Static<typeof EnterpriseSessionsListResultSchema>;
export type EnterpriseSessionRevokeParams = Static<typeof EnterpriseSessionRevokeParamsSchema>;
export type EnterpriseSessionRevokeResult = Static<typeof EnterpriseSessionRevokeResultSchema>;
export type EnterpriseAuditQueryParams = Static<typeof EnterpriseAuditQueryParamsSchema>;
export type EnterpriseAuditQueryResult = Static<typeof EnterpriseAuditQueryResultSchema>;
export type EnterpriseAuditExportParams = Static<typeof EnterpriseAuditExportParamsSchema>;
export type EnterpriseAuditExportResult = Static<typeof EnterpriseAuditExportResultSchema>;
export type EnterpriseGdprExportParams = Static<typeof EnterpriseGdprExportParamsSchema>;
export type EnterpriseGdprExportResult = Static<typeof EnterpriseGdprExportResultSchema>;
export type EnterpriseGdprEraseParams = Static<typeof EnterpriseGdprEraseParamsSchema>;
export type EnterpriseGdprEraseResult = Static<typeof EnterpriseGdprEraseResultSchema>;
export type EnterpriseMfaEnrollParams = Static<typeof EnterpriseMfaEnrollParamsSchema>;
export type EnterpriseMfaEnrollResult = Static<typeof EnterpriseMfaEnrollResultSchema>;
export type EnterpriseMfaVerifyParams = Static<typeof EnterpriseMfaVerifyParamsSchema>;
export type EnterpriseMfaVerifyResult = Static<typeof EnterpriseMfaVerifyResultSchema>;
export type EnterpriseMfaConfirmEnrollParams = Static<
  typeof EnterpriseMfaConfirmEnrollParamsSchema
>;
export type EnterpriseMfaConfirmEnrollResult = Static<
  typeof EnterpriseMfaConfirmEnrollResultSchema
>;
export type EnterpriseMfaDisableParams = Static<typeof EnterpriseMfaDisableParamsSchema>;
export type EnterpriseMfaDisableResult = Static<typeof EnterpriseMfaDisableResultSchema>;
export type EnterpriseIpAllowlistCheckParams = Static<
  typeof EnterpriseIpAllowlistCheckParamsSchema
>;
export type EnterpriseIpAllowlistCheckResult = Static<
  typeof EnterpriseIpAllowlistCheckResultSchema
>;
