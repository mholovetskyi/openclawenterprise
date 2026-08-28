import { consume } from "@lit/context";
import { html } from "lit";
import { state } from "lit/decorators.js";
import { titleForRoute } from "../../app-navigation.ts";
import { applicationContext, type ApplicationContext } from "../../app/context.ts";
import { renderSettingsPageHeader } from "../../components/settings-ui.ts";
import { renderSettingsWorkspace } from "../../components/settings-workspace.ts";
import { t } from "../../i18n/index.ts";
import {
  loadEnterpriseAudit,
  loadEnterpriseUsers,
  upsertEnterpriseUser,
  type EnterpriseAuditEventSummary,
  type EnterpriseRbacUser,
} from "../../lib/enterprise/api.ts";
import {
  loadEnterpriseBranding,
  saveEnterpriseBranding,
} from "../../lib/enterprise/branding.ts";
import { GatewayPageController } from "../../lit/gateway-page-controller.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";
import type { AuditEventRow, EnterpriseStatus, EnterpriseTab, MetricSnapshot } from "./types.ts";
import { renderEnterprise } from "./view.ts";
import "../../styles/enterprise.css";

function toAuditRow(event: EnterpriseAuditEventSummary): AuditEventRow {
  const parsed = Date.parse(event.timestamp);
  const outcome =
    event.outcome === "failure" || event.outcome === "blocked" ? event.outcome : "success";
  const resource = event.resourceType
    ? `${event.resourceType}${event.resourceId ? `:${event.resourceId}` : ""}`
    : event.resourceId;
  return {
    id: event.id,
    ts: Number.isFinite(parsed) ? parsed : 0,
    action: event.action,
    actor: event.actorEmail ?? event.actorId,
    resource,
    tenantId: event.tenantId,
    outcome,
  };
}

class EnterprisePage extends OpenClawLightDomElement {
  @consume({ context: applicationContext, subscribe: true })
  private context!: ApplicationContext;

  // Populated by a future enterprise.status/metrics RPC; the overview and
  // security tabs render their disabled/empty states while these stay null.
  @state() private enterpriseStatus: EnterpriseStatus | null = null;
  @state() private enterpriseMetrics: MetricSnapshot | null = null;
  @state() private auditEvents: AuditEventRow[] = [];
  @state() private auditLoading = false;
  @state() private users: EnterpriseRbacUser[] = [];
  @state() private usersLoading = false;
  @state() private activeTab: EnterpriseTab = "overview";
  @state() private userEditingId: string | null = null;
  @state() private userEditRoles: string[] = [];
  @state() private userEditActive = true;
  @state() private branding = loadEnterpriseBranding();

  private initialDataRequested = false;

  private readonly gateway = new GatewayPageController(this, {
    getGateway: () => this.context?.gateway,
    invalidateRequests: () => this.resetGatewayState(),
    ensureInitialData: () => this.ensureInitialData(),
  });

  private get client() {
    const snapshot = this.gateway.snapshot;
    return snapshot?.phase === "connected" ? (snapshot.client ?? null) : null;
  }

  private resetGatewayState() {
    this.auditEvents = [];
    this.auditLoading = false;
    this.users = [];
    this.usersLoading = false;
    this.userEditingId = null;
    this.userEditRoles = [];
    this.initialDataRequested = false;
  }

  private ensureInitialData() {
    if (this.initialDataRequested || !this.client) {
      return;
    }
    this.initialDataRequested = true;
    this.refreshUsers();
    this.refreshAudit();
  }

  private refreshAudit() {
    const client = this.client;
    if (!client || this.auditLoading) {
      return;
    }
    this.auditLoading = true;
    void loadEnterpriseAudit(client, { limit: 100 })
      .then((result) => {
        if (this.client !== client) {
          return;
        }
        this.auditEvents = result.events.map(toAuditRow);
        this.auditLoading = false;
      })
      .catch(() => {
        if (this.client === client) {
          this.auditLoading = false;
        }
      });
  }

  private refreshUsers() {
    const client = this.client;
    if (!client || this.usersLoading) {
      return;
    }
    this.usersLoading = true;
    void loadEnterpriseUsers(client)
      .then((result) => {
        if (this.client !== client) {
          return;
        }
        this.users = result.users;
        this.usersLoading = false;
      })
      .catch(() => {
        if (this.client === client) {
          this.usersLoading = false;
        }
      });
  }

  private saveUserEdit(userId: string) {
    const client = this.client;
    const user = this.users.find((candidate) => candidate.id === userId);
    if (!client || !user) {
      return;
    }
    const roles = this.userEditRoles;
    const active = this.userEditActive;
    // Optimistic local update; the gateway is the source of truth on refresh.
    this.users = this.users.map((candidate) =>
      candidate.id === userId ? { ...candidate, roles, active } : candidate,
    );
    this.userEditingId = null;
    this.userEditRoles = [];
    const { createdAt: _createdAt, lastSeenAt: _lastSeenAt, mfaEnabled: _mfaEnabled, ...rest } = user;
    void upsertEnterpriseUser(client, { ...rest, roles, active }).catch((err: unknown) => {
      console.error("[enterprise] failed to save user edit:", err);
    });
  }

  private applyBranding(title: string, tagline: string) {
    const branding = { title: title.trim(), tagline: tagline.trim() };
    this.branding = branding;
    saveEnterpriseBranding(branding);
  }

  override render() {
    const body = renderEnterprise({
      status: this.enterpriseStatus,
      metrics: this.enterpriseMetrics,
      auditEvents: this.auditEvents,
      auditLoading: this.auditLoading,
      users: this.users,
      usersLoading: this.usersLoading,
      activeTab: this.activeTab,
      onTabChange: (tab) => {
        this.activeTab = tab;
      },
      onRefreshMetrics: () => {
        // Metrics come from Prometheus /metrics — displayed via the overview tab.
      },
      onRefreshAudit: () => this.refreshAudit(),
      onRefreshUsers: () => this.refreshUsers(),
      editingUserId: this.userEditingId,
      editingUserRoles: this.userEditRoles,
      editingUserActive: this.userEditActive,
      onStartEditUser: (userId, roles, active) => {
        this.userEditingId = userId;
        this.userEditRoles = [...roles];
        this.userEditActive = active;
      },
      onEditUserRolesChange: (roles) => {
        this.userEditRoles = roles;
      },
      onEditUserActiveChange: (active) => {
        this.userEditActive = active;
      },
      onSaveUserEdit: (userId) => this.saveUserEdit(userId),
      onCancelUserEdit: () => {
        this.userEditingId = null;
        this.userEditRoles = [];
      },
      dashboardTitle: this.branding.title,
      dashboardTagline: this.branding.tagline,
      onDashboardSettingsChange: (title, tagline) => this.applyBranding(title, tagline),
    });
    return html`
      ${renderSettingsPageHeader({
        title: titleForRoute("enterprise"),
        subtitle: t("subtitles.enterprise"),
      })}
      ${renderSettingsWorkspace(body)}
    `;
  }
}

if (!customElements.get("openclaw-enterprise-page")) {
  customElements.define("openclaw-enterprise-page", EnterprisePage);
}
