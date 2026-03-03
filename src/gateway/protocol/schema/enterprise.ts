/**
 * Enterprise IAM / audit gateway RPC schemas.
 * All enterprise methods require the caller to hold the "admin" role or higher.
 */

import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

// ── Shared shapes ─────────────────────────────────────────────────────────────

export const RbacRoleSchema = Type.Object(
  {
    id: NonEmptyString,
    displayName: Type.String(),
    permissions: Type.Array(NonEmptyString),
    builtIn: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const RbacUserSchema = Type.Object(
  {
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
  },
  { additionalProperties: false },
);

export const RbacGroupSchema = Type.Object(
  {
    id: NonEmptyString,
    displayName: Type.String(),
    roles: Type.Array(NonEmptyString),
    memberIds: Type.Array(NonEmptyString),
    tenantId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const AuditEventSummarySchema = Type.Object(
  {
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
  },
  { additionalProperties: false },
);

export const ActiveSessionSchema = Type.Object(
  {
    jti: NonEmptyString,
    subjectId: NonEmptyString,
    issuedAt: Type.Integer({ minimum: 0 }),
    expiresAt: Type.Integer({ minimum: 0 }),
    userAgent: Type.Optional(Type.String()),
    ipAddress: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

// ── Users ─────────────────────────────────────────────────────────────────────

export const EnterpriseUsersListParamsSchema = Type.Object(
  {
    tenantId: Type.Optional(NonEmptyString),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 100 })),
    offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
  },
  { additionalProperties: false },
);
export const EnterpriseUsersListResultSchema = Type.Object(
  { users: Type.Array(RbacUserSchema), total: Type.Integer({ minimum: 0 }) },
  { additionalProperties: false },
);

export const EnterpriseUserGetParamsSchema = Type.Object(
  { userId: NonEmptyString },
  { additionalProperties: false },
);
export const EnterpriseUserGetResultSchema = RbacUserSchema;

export const EnterpriseUserUpsertParamsSchema = Type.Object(
  {
    id: NonEmptyString,
    name: Type.Optional(Type.String()),
    email: Type.Optional(Type.String()),
    roles: Type.Array(NonEmptyString),
    groups: Type.Optional(Type.Array(NonEmptyString)),
    tenantId: Type.Optional(NonEmptyString),
    active: Type.Boolean(),
    allowedCidrs: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);
export const EnterpriseUserUpsertResultSchema = Type.Object(
  { ok: Type.Literal(true) },
  { additionalProperties: false },
);

export const EnterpriseUserDeleteParamsSchema = Type.Object(
  { userId: NonEmptyString },
  { additionalProperties: false },
);
export const EnterpriseUserDeleteResultSchema = Type.Object(
  { ok: Type.Literal(true) },
  { additionalProperties: false },
);

// ── Roles ─────────────────────────────────────────────────────────────────────

export const EnterpriseRolesListParamsSchema = Type.Object({}, { additionalProperties: false });
export const EnterpriseRolesListResultSchema = Type.Object(
  { roles: Type.Array(RbacRoleSchema) },
  { additionalProperties: false },
);

// ── Sessions ──────────────────────────────────────────────────────────────────

export const EnterpriseSessionsListParamsSchema = Type.Object(
  { subjectId: NonEmptyString },
  { additionalProperties: false },
);
export const EnterpriseSessionsListResultSchema = Type.Object(
  { sessions: Type.Array(ActiveSessionSchema) },
  { additionalProperties: false },
);

export const EnterpriseSessionRevokeParamsSchema = Type.Object(
  {
    jti: Type.Optional(NonEmptyString), // revoke a specific session
    subjectId: Type.Optional(NonEmptyString), // revoke ALL sessions for a user
  },
  { additionalProperties: false },
);
export const EnterpriseSessionRevokeResultSchema = Type.Object(
  { revoked: Type.Integer({ minimum: 0 }) },
  { additionalProperties: false },
);

// ── Audit ─────────────────────────────────────────────────────────────────────

export const EnterpriseAuditQueryParamsSchema = Type.Object(
  {
    actorId: Type.Optional(NonEmptyString),
    category: Type.Optional(NonEmptyString),
    action: Type.Optional(NonEmptyString),
    outcome: Type.Optional(NonEmptyString),
    tenantId: Type.Optional(NonEmptyString),
    from: Type.Optional(NonEmptyString), // ISO 8601
    until: Type.Optional(NonEmptyString), // ISO 8601
    search: Type.Optional(NonEmptyString),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000, default: 50 })),
    offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
  },
  { additionalProperties: false },
);
export const EnterpriseAuditQueryResultSchema = Type.Object(
  {
    events: Type.Array(AuditEventSummarySchema),
    total: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const EnterpriseAuditExportParamsSchema = Type.Object(
  {
    format: Type.Union([Type.Literal("json"), Type.Literal("ndjson")]),
    from: Type.Optional(NonEmptyString),
    until: Type.Optional(NonEmptyString),
    tenantId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);
export const EnterpriseAuditExportResultSchema = Type.Object(
  {
    url: Type.Optional(NonEmptyString), // download URL if returned as file
    data: Type.Optional(Type.String()), // inline NDJSON for small exports
  },
  { additionalProperties: false },
);

// ── GDPR ──────────────────────────────────────────────────────────────────────

export const EnterpriseGdprExportParamsSchema = Type.Object(
  { userId: NonEmptyString },
  { additionalProperties: false },
);
export const EnterpriseGdprExportResultSchema = Type.Object(
  { data: Type.Unknown() },
  { additionalProperties: false },
);

export const EnterpriseGdprEraseParamsSchema = Type.Object(
  { userId: NonEmptyString },
  { additionalProperties: false },
);
export const EnterpriseGdprEraseResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    auditEventsAnonymized: Type.Integer({ minimum: 0 }),
    sessionsRevoked: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

// ── MFA ───────────────────────────────────────────────────────────────────────

export const EnterpriseMfaEnrollParamsSchema = Type.Object(
  { userId: NonEmptyString },
  { additionalProperties: false },
);
export const EnterpriseMfaEnrollResultSchema = Type.Object(
  {
    secret: NonEmptyString, // base32 TOTP secret (show once to user)
    otpauthUri: NonEmptyString, // otpauth:// URI for QR code rendering
  },
  { additionalProperties: false },
);

export const EnterpriseMfaVerifyParamsSchema = Type.Object(
  { userId: NonEmptyString, code: NonEmptyString },
  { additionalProperties: false },
);
export const EnterpriseMfaVerifyResultSchema = Type.Object(
  { ok: Type.Boolean() },
  { additionalProperties: false },
);

export const EnterpriseMfaDisableParamsSchema = Type.Object(
  { userId: NonEmptyString },
  { additionalProperties: false },
);
export const EnterpriseMfaDisableResultSchema = Type.Object(
  { ok: Type.Literal(true) },
  { additionalProperties: false },
);
