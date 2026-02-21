// Enterprise admin dashboard — shared types

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

export type RbacUser = {
  id: string;
  email?: string;
  displayName?: string;
  roles: string[];
  groups: string[];
  active: boolean;
};

export type EnterpriseAdminProps = {
  status: EnterpriseStatus | null;
  metrics: MetricSnapshot | null;
  auditEvents: AuditEventRow[];
  auditLoading: boolean;
  users: RbacUser[];
  usersLoading: boolean;
  activeTab: EnterpriseTab;
  onTabChange: (tab: EnterpriseTab) => void;
  onRefreshMetrics: () => void;
  onRefreshAudit: () => void;
  onRefreshUsers: () => void;
};

export type EnterpriseTab = "overview" | "users" | "audit" | "security" | "cluster";
