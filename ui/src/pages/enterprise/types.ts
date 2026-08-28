// Enterprise admin page — shared view types.
import type { EnterpriseRbacUser } from "../../lib/enterprise/api.ts";

export type EnterpriseStatus = {
  enabled: boolean;
  version: string;
  nodeId?: string;
  subsystems: {
    secrets: SubsystemStatus;
    iam: SubsystemStatus;
    audit: SubsystemStatus;
    monitoring: SubsystemStatus;
    tenancy: SubsystemStatus;
    cluster: SubsystemStatus;
  };
};

export type SubsystemStatus = {
  enabled: boolean;
  healthy: boolean;
  detail?: string;
};

export type MetricSnapshot = {
  gatewayConnectionsActive: number;
  gatewayRequestsTotal: number;
  agentRunsTotal: number;
  agentRunsActive: number;
  agentErrorsTotal: number;
  skillInvocationsTotal: number;
  authSuccessTotal: number;
  authFailureTotal: number;
  auditEventsTotal: number;
  guardrailBlocksTotal: number;
  tenantCount: number;
  clusterNodeCount: number;
};

export type AuditEventRow = {
  id: string;
  ts: number;
  action: string;
  actor: string;
  resource?: string;
  tenantId?: string;
  outcome: "success" | "failure" | "blocked";
  ip?: string;
};

export type EnterpriseAdminProps = {
  status: EnterpriseStatus | null;
  metrics: MetricSnapshot | null;
  auditEvents: AuditEventRow[];
  auditLoading: boolean;
  users: EnterpriseRbacUser[];
  usersLoading: boolean;
  activeTab: EnterpriseTab;
  onTabChange: (tab: EnterpriseTab) => void;
  onRefreshMetrics: () => void;
  onRefreshAudit: () => void;
  onRefreshUsers: () => void;
  // Inline user role/status editing
  editingUserId: string | null;
  editingUserRoles: string[];
  editingUserActive: boolean;
  onStartEditUser: (userId: string, currentRoles: string[], currentActive: boolean) => void;
  onEditUserRolesChange: (roles: string[]) => void;
  onEditUserActiveChange: (active: boolean) => void;
  onSaveUserEdit: (userId: string) => void;
  onCancelUserEdit: () => void;
  // Dashboard branding customization
  dashboardTitle: string;
  dashboardTagline: string;
  onDashboardSettingsChange: (title: string, tagline: string) => void;
};

export type EnterpriseTab = "overview" | "users" | "audit" | "security" | "cluster" | "settings";

// Built-in roles available for assignment in the UI
export const BUILTIN_ROLES = ["admin", "operator", "viewer"] as const;
export type BuiltinRole = (typeof BUILTIN_ROLES)[number];
