/**
 * Enterprise admin page — view templates.
 *
 * Renders the enterprise shell with sub-tabs:
 *   overview | users | audit | security | cluster | settings
 *
 * Ported from the pre-restructure ui/src/ui/views/enterprise/* modules;
 * styles live in ui/src/styles/enterprise.css (imported by enterprise-page.ts).
 */
import { html, nothing } from "lit";
import { renderHubTabs } from "../../components/hub-tabs.ts";
import type { EnterpriseRbacUser } from "../../lib/enterprise/api.ts";
import type {
  AuditEventRow,
  EnterpriseAdminProps,
  EnterpriseTab,
  SubsystemStatus,
} from "./types.ts";
import { BUILTIN_ROLES } from "./types.ts";

const TABS: Array<{ id: EnterpriseTab; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "🏢" },
  { id: "users", label: "Users & roles", icon: "👤" },
  { id: "audit", label: "Audit log", icon: "📋" },
  { id: "security", label: "Security", icon: "🛡️" },
  { id: "cluster", label: "Cluster", icon: "🔗" },
  { id: "settings", label: "Settings", icon: "⚙️" },
];

export function renderEnterprise(props: EnterpriseAdminProps) {
  return html`
    <div class="ent-shell">
      <div class="ent-header">
        <span class="ent-header-title">🦞 Enterprise</span>
        ${props.status?.version
          ? html`<span class="ent-header-version muted">v${props.status.version}</span>`
          : nothing}
      </div>

      ${renderHubTabs<EnterpriseTab>({
        id: "enterprise",
        active: props.activeTab,
        tabs: TABS.map((tab) => ({
          value: tab.id,
          label: html`<span class="ent-tab-icon">${tab.icon}</span>
            <span class="ent-tab-label">${tab.label}</span>`,
        })),
        ariaLabel: "Enterprise sections",
        panelId: "ent-panel",
        variant: "sub",
        onSelect: (tab) => props.onTabChange(tab),
      })}

      <div class="ent-content" id="ent-panel" role="tabpanel">
        ${props.activeTab === "overview" ? renderEnterpriseOverview(props) : nothing}
        ${props.activeTab === "users" ? renderEnterpriseUsers(props) : nothing}
        ${props.activeTab === "audit" ? renderEnterpriseAudit(props) : nothing}
        ${props.activeTab === "security" ? renderEnterpriseSecurity(props) : nothing}
        ${props.activeTab === "cluster" ? renderEnterpriseCluster(props) : nothing}
        ${props.activeTab === "settings" ? renderEnterpriseSettings(props) : nothing}
      </div>
    </div>
  `;
}

// ── Overview ──────────────────────────────────────────────────────────────────

function statusBadge(s: SubsystemStatus) {
  if (!s.enabled) {
    return html`<span class="ent-badge ent-badge--disabled">disabled</span>`;
  }
  if (!s.healthy) {
    return html`<span class="ent-badge ent-badge--error">unhealthy</span>`;
  }
  return html`<span class="ent-badge ent-badge--ok">ok</span>`;
}

function metricCard(label: string, value: string | number, sub?: string) {
  return html`
    <div class="ent-metric-card">
      <div class="ent-metric-value">${value}</div>
      <div class="ent-metric-label">${label}</div>
      ${sub ? html`<div class="ent-metric-sub">${sub}</div>` : nothing}
    </div>
  `;
}

function subsystemRow(icon: string, label: string, s: SubsystemStatus) {
  return html`
    <div class="ent-subsystem-row">
      <span class="ent-subsystem-icon">${icon}</span>
      <span class="ent-subsystem-label">${label}</span>
      <span class="ent-subsystem-status">${statusBadge(s)}</span>
      ${s.detail ? html`<span class="ent-subsystem-detail muted">${s.detail}</span>` : nothing}
    </div>
  `;
}

function renderEnterpriseOverview(props: EnterpriseAdminProps) {
  const { status, metrics } = props;

  if (!status?.enabled) {
    return html`
      <div class="ent-empty">
        <div class="ent-empty-icon">🏢</div>
        <div class="ent-empty-title">Enterprise features are not enabled</div>
        <div class="ent-empty-body">
          Set <code>enterprise.enabled: true</code> in your <code>config.yaml</code> to activate
          IAM, audit logging, Prometheus metrics, multi-tenancy, and more.
        </div>
        <a
          class="ent-link"
          href="https://github.com/mholovetskyi/openclawenterprise/tree/main/docs/enterprise"
          target="_blank"
          rel="noreferrer"
          >Enterprise docs →</a
        >
      </div>
    `;
  }

  const ss = status.subsystems;

  return html`
    <div class="ent-overview">
      <section class="ent-section">
        <h3 class="ent-section-title">Subsystems</h3>
        <div class="ent-subsystem-grid">
          ${subsystemRow("🔐", "Secrets", ss.secrets)} ${subsystemRow("👤", "IAM / RBAC", ss.iam)}
          ${subsystemRow("📋", "Audit logging", ss.audit)}
          ${subsystemRow("📊", "Monitoring", ss.monitoring)}
          ${subsystemRow("🏢", "Multi-tenancy", ss.tenancy)}
          ${subsystemRow("🔗", "Cluster", ss.cluster)}
        </div>
      </section>

      ${metrics
        ? html`
            <section class="ent-section">
              <div class="ent-section-header">
                <h3 class="ent-section-title">Live metrics</h3>
                <button class="ent-btn-sm" @click=${props.onRefreshMetrics}>↻ Refresh</button>
              </div>
              <div class="ent-metrics-grid">
                ${metricCard("Active connections", metrics.gatewayConnectionsActive)}
                ${metricCard("Total requests", metrics.gatewayRequestsTotal.toLocaleString())}
                ${metricCard(
                  "Agent runs",
                  metrics.agentRunsTotal.toLocaleString(),
                  `${metrics.agentRunsActive} active`,
                )}
                ${metricCard("Agent errors", metrics.agentErrorsTotal.toLocaleString())}
                ${metricCard("Skill invocations", metrics.skillInvocationsTotal.toLocaleString())}
                ${metricCard(
                  "Auth",
                  `${metrics.authSuccessTotal.toLocaleString()} ok`,
                  `${metrics.authFailureTotal.toLocaleString()} failed`,
                )}
                ${metricCard("Audit events", metrics.auditEventsTotal.toLocaleString())}
                ${metricCard("Guardrail blocks", metrics.guardrailBlocksTotal.toLocaleString())}
                ${ss.tenancy.enabled ? metricCard("Tenants", metrics.tenantCount) : nothing}
                ${ss.cluster.enabled
                  ? metricCard("Cluster nodes", metrics.clusterNodeCount)
                  : nothing}
              </div>
            </section>
          `
        : nothing}

      <section class="ent-section">
        <h3 class="ent-section-title">Instance</h3>
        <div class="ent-kv-grid">
          <span class="ent-kv-key">Node ID</span>
          <span class="ent-kv-val"><code>${status.nodeId ?? "—"}</code></span>
          <span class="ent-kv-key">Version</span>
          <span class="ent-kv-val"><code>${status.version}</code></span>
        </div>
      </section>
    </div>
  `;
}

// ── Users & roles ─────────────────────────────────────────────────────────────

function renderPillList(items: string[], type: string) {
  if (items.length === 0) {
    return html`<span class="muted">—</span>`;
  }
  return html`
    <span class="ent-pill-list">
      ${items.map((item) => html`<span class="ent-pill ent-pill--${type}">${item}</span>`)}
    </span>
  `;
}

function userDisplayName(u: EnterpriseRbacUser): string | undefined {
  return u.displayName ?? u.name;
}

function renderViewRow(u: EnterpriseRbacUser, props: EnterpriseAdminProps) {
  return html`
    <tr class=${u.active ? "" : "ent-row--inactive"}>
      <td class="mono ent-td-truncate">${u.id}</td>
      <td>${userDisplayName(u) ?? html`<span class="muted">—</span>`}</td>
      <td class="muted">${u.email ?? "—"}</td>
      <td>${renderPillList(u.roles, "role")}</td>
      <td>${renderPillList(u.groups, "group")}</td>
      <td>
        ${u.active
          ? html`<span class="ent-badge ent-badge--ok">active</span>`
          : html`<span class="ent-badge ent-badge--disabled">inactive</span>`}
      </td>
      <td>
        <button
          class="ent-btn-sm"
          @click=${() => props.onStartEditUser(u.id, [...u.roles], u.active)}
          title="Edit roles and status for ${userDisplayName(u) ?? u.id}"
        >
          Edit
        </button>
      </td>
    </tr>
  `;
}

function renderEditRow(u: EnterpriseRbacUser, props: EnterpriseAdminProps) {
  const { editingUserRoles, editingUserActive } = props;

  function toggleRole(role: string) {
    const next = editingUserRoles.includes(role)
      ? editingUserRoles.filter((r) => r !== role)
      : [...editingUserRoles, role];
    props.onEditUserRolesChange(next);
  }

  return html`
    <tr class="ent-edit-row">
      <td class="mono ent-td-truncate">${u.id}</td>
      <td>${userDisplayName(u) ?? html`<span class="muted">—</span>`}</td>
      <td class="muted">${u.email ?? "—"}</td>
      <td>
        <div class="ent-role-checkboxes">
          ${BUILTIN_ROLES.map(
            (role) => html`
              <label class="ent-role-check">
                <input
                  type="checkbox"
                  .checked=${editingUserRoles.includes(role)}
                  @change=${() => toggleRole(role)}
                />
                <span class="ent-pill ent-pill--role">${role}</span>
              </label>
            `,
          )}
        </div>
      </td>
      <td>${renderPillList(u.groups, "group")}</td>
      <td>
        <label class="ent-active-toggle">
          <input
            type="checkbox"
            .checked=${editingUserActive}
            @change=${(e: Event) =>
              props.onEditUserActiveChange((e.target as HTMLInputElement).checked)}
          />
          <span>${editingUserActive ? "active" : "inactive"}</span>
        </label>
      </td>
      <td>
        <div class="ent-edit-actions">
          <button
            class="ent-btn-sm ent-btn-sm--primary"
            @click=${() => props.onSaveUserEdit(u.id)}
            title="Save changes"
          >
            Save
          </button>
          <button class="ent-btn-sm" @click=${props.onCancelUserEdit} title="Discard changes">
            Cancel
          </button>
        </div>
      </td>
    </tr>
  `;
}

function renderEnterpriseUsers(props: EnterpriseAdminProps) {
  const { users, usersLoading, editingUserId } = props;

  return html`
    <div class="ent-users">
      <div class="ent-section-header">
        <h3 class="ent-section-title">Users &amp; roles</h3>
        <button class="ent-btn-sm" @click=${props.onRefreshUsers} ?disabled=${usersLoading}>
          ${usersLoading ? "Loading…" : "↻ Refresh"}
        </button>
      </div>

      ${usersLoading && users.length === 0
        ? html`<div class="ent-loading">Loading users…</div>`
        : nothing}
      ${!usersLoading && users.length === 0
        ? html`
            <div class="ent-empty">
              <div class="ent-empty-title">No users configured</div>
              <div class="ent-empty-body">
                Users and roles are managed via <code>enterprise.iam</code> in your config, or
                provisioned programmatically through the IAM API.
              </div>
            </div>
          `
        : nothing}
      ${users.length > 0
        ? html`
            <div class="ent-table-wrap">
              <table class="ent-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Display name</th>
                    <th>Email</th>
                    <th>Roles</th>
                    <th>Groups</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${users.map((u) =>
                    editingUserId === u.id ? renderEditRow(u, props) : renderViewRow(u, props),
                  )}
                </tbody>
              </table>
            </div>
            <p class="muted" style="font-size:11px;margin-top:8px">
              Click <strong>Edit</strong> to change a user's roles or active status. Changes are
              written to the gateway via the IAM API when connected.
            </p>
          `
        : nothing}
    </div>
  `;
}

// ── Audit log ─────────────────────────────────────────────────────────────────

function outcomeChip(outcome: AuditEventRow["outcome"]) {
  const map = {
    success: html`<span class="ent-badge ent-badge--ok">success</span>`,
    failure: html`<span class="ent-badge ent-badge--error">failure</span>`,
    blocked: html`<span class="ent-badge ent-badge--warn">blocked</span>`,
  };
  return map[outcome] ?? nothing;
}

function formatTs(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ").slice(0, 19);
}

function renderEnterpriseAudit(props: EnterpriseAdminProps) {
  const { auditEvents, auditLoading } = props;

  return html`
    <div class="ent-audit">
      <div class="ent-section-header">
        <h3 class="ent-section-title">Audit log</h3>
        <button class="ent-btn-sm" @click=${props.onRefreshAudit} ?disabled=${auditLoading}>
          ${auditLoading ? "Loading…" : "↻ Refresh"}
        </button>
      </div>

      ${auditLoading && auditEvents.length === 0
        ? html`<div class="ent-loading">Loading audit events…</div>`
        : nothing}
      ${!auditLoading && auditEvents.length === 0
        ? html`
            <div class="ent-empty">
              <div class="ent-empty-title">No audit events yet</div>
              <div class="ent-empty-body">
                Events are recorded as you use OpenClaw with enterprise audit logging enabled.
              </div>
            </div>
          `
        : nothing}
      ${auditEvents.length > 0
        ? html`
            <div class="ent-table-wrap">
              <table class="ent-table">
                <thead>
                  <tr>
                    <th>Time (UTC)</th>
                    <th>Action</th>
                    <th>Actor</th>
                    <th>Resource</th>
                    ${auditEvents.some((e) => e.tenantId) ? html`<th>Tenant</th>` : nothing}
                    <th>Outcome</th>
                    <th>IP</th>
                  </tr>
                </thead>
                <tbody>
                  ${auditEvents.map(
                    (ev) => html`
                      <tr>
                        <td class="mono ent-td-ts">${formatTs(ev.ts)}</td>
                        <td class="mono">${ev.action}</td>
                        <td class="ent-td-truncate">${ev.actor}</td>
                        <td class="ent-td-truncate muted">${ev.resource ?? "—"}</td>
                        ${auditEvents.some((e) => e.tenantId)
                          ? html`<td class="muted">${ev.tenantId ?? "—"}</td>`
                          : nothing}
                        <td>${outcomeChip(ev.outcome)}</td>
                        <td class="mono muted">${ev.ip ?? "—"}</td>
                      </tr>
                    `,
                  )}
                </tbody>
              </table>
            </div>
            <div class="ent-table-footer muted">
              Showing ${auditEvents.length} most recent events · Full log in
              <code>~/.openclaw/audit.db</code>
            </div>
          `
        : nothing}
    </div>
  `;
}

// ── Security ──────────────────────────────────────────────────────────────────

function defenseRow(icon: string, label: string, active: boolean, description: string) {
  return html`
    <div class="ent-defense-row ${active ? "" : "ent-defense-row--inactive"}">
      <span class="ent-defense-icon">${icon}</span>
      <div class="ent-defense-body">
        <span class="ent-defense-label">${label}</span>
        <span class="ent-defense-desc muted">${description}</span>
      </div>
      <span class="ent-defense-state">
        ${active
          ? html`<span class="ent-badge ent-badge--ok">active</span>`
          : html`<span class="ent-badge ent-badge--disabled">inactive</span>`}
      </span>
    </div>
  `;
}

function renderEnterpriseSecurity(props: EnterpriseAdminProps) {
  const { status, metrics } = props;
  const guardrailBlocks = metrics?.guardrailBlocksTotal ?? 0;
  const authFailures = metrics?.authFailureTotal ?? 0;

  return html`
    <div class="ent-security">
      <h3 class="ent-section-title">Security dashboard</h3>

      <div class="ent-alert-row">
        ${authFailures > 0
          ? html`
              <div class="ent-alert ent-alert--warn">
                <span class="ent-alert-icon">⚠️</span>
                <span class="ent-alert-msg">
                  <strong>${authFailures.toLocaleString()}</strong> authentication
                  ${authFailures === 1 ? "failure" : "failures"} recorded
                </span>
              </div>
            `
          : html`
              <div class="ent-alert ent-alert--ok">
                <span class="ent-alert-icon">✓</span>
                <span class="ent-alert-msg">No authentication failures</span>
              </div>
            `}
        ${guardrailBlocks > 0
          ? html`
              <div class="ent-alert ent-alert--info">
                <span class="ent-alert-icon">🛡️</span>
                <span class="ent-alert-msg">
                  <strong>${guardrailBlocks.toLocaleString()}</strong> request
                  ${guardrailBlocks === 1 ? "was" : "were"} blocked by guardrails
                </span>
              </div>
            `
          : html`
              <div class="ent-alert ent-alert--ok">
                <span class="ent-alert-icon">✓</span>
                <span class="ent-alert-msg">No guardrail blocks</span>
              </div>
            `}
      </div>

      <section class="ent-section" style="margin-top:24px">
        <h4 class="ent-section-subtitle">Active defenses</h4>
        <div class="ent-defense-list">
          ${defenseRow(
            "🔒",
            "Gateway binding",
            status?.enabled ?? false,
            "Loopback-only by default; explicit warning on LAN exposure",
          )}
          ${defenseRow(
            "🧹",
            "Prompt injection sanitizer",
            status?.enabled ?? false,
            "Unicode normalization, invisible char stripping, injection pattern detection",
          )}
          ${defenseRow(
            "🛡️",
            "Runtime guardrails",
            status?.enabled ?? false,
            "Credential harvest, reverse shell, mass delete, PII detection",
          )}
          ${defenseRow(
            "🔑",
            "AES-256-GCM secrets encryption",
            status?.subsystems.secrets.enabled ?? false,
            "Plaintext credential files replaced with encrypted backend",
          )}
          ${defenseRow(
            "👤",
            "IAM / RBAC",
            status?.subsystems.iam.enabled ?? false,
            "Role-based access control with group inheritance and wildcards",
          )}
          ${defenseRow(
            "📋",
            "Tamper-evident audit log",
            status?.subsystems.audit.enabled ?? false,
            "SHA-256 hash chain; every event references previous event's hash",
          )}
          ${defenseRow(
            "✍️",
            "Skill code signing",
            status?.enabled ?? false,
            "Ed25519 signatures on skill directories; untrusted skills rejected",
          )}
          ${defenseRow(
            "🔍",
            "Enterprise SAST",
            status?.enabled ?? false,
            "14 rules covering credential harvest, RCE, prototype pollution, path traversal",
          )}
        </div>
      </section>

      <section class="ent-section" style="margin-top:24px">
        <h4 class="ent-section-subtitle">Resources</h4>
        <div class="ent-link-list">
          <a
            class="ent-link"
            href="https://github.com/mholovetskyi/openclawenterprise/blob/main/docs/enterprise/security.md"
            target="_blank"
            rel="noreferrer"
            >Security hardening guide →</a
          >
          <a
            class="ent-link"
            href="https://github.com/mholovetskyi/openclawenterprise/blob/main/docs/enterprise/iam.md"
            target="_blank"
            rel="noreferrer"
            >IAM & RBAC docs →</a
          >
          <a
            class="ent-link"
            href="https://github.com/mholovetskyi/openclawenterprise/security/advisories"
            target="_blank"
            rel="noreferrer"
            >Security advisories →</a
          >
        </div>
      </section>
    </div>
  `;
}

// ── Cluster & tenancy ─────────────────────────────────────────────────────────

function renderEnterpriseCluster(props: EnterpriseAdminProps) {
  const { status, metrics } = props;
  const clusterEnabled = status?.subsystems.cluster.enabled ?? false;
  const tenancyEnabled = status?.subsystems.tenancy.enabled ?? false;

  if (!clusterEnabled && !tenancyEnabled) {
    return html`
      <div class="ent-empty">
        <div class="ent-empty-icon">🔗</div>
        <div class="ent-empty-title">Cluster &amp; tenancy not enabled</div>
        <div class="ent-empty-body">
          Enable <code>enterprise.cluster.enabled: true</code> for distributed multi-node mode and
          <code>enterprise.tenancy.enabled: true</code> for multi-tenant isolation.
        </div>
      </div>
    `;
  }

  return html`
    <div class="ent-cluster">
      ${clusterEnabled
        ? html`
            <section class="ent-section">
              <h3 class="ent-section-title">Cluster</h3>
              <div class="ent-kv-grid">
                <span class="ent-kv-key">This node</span>
                <span class="ent-kv-val"><code>${status?.nodeId ?? "—"}</code></span>
                <span class="ent-kv-key">Active nodes</span>
                <span class="ent-kv-val">${metrics?.clusterNodeCount ?? "—"}</span>
                <span class="ent-kv-key">Message bus</span>
                <span class="ent-kv-val">
                  ${status?.subsystems.cluster.healthy
                    ? html`<span class="ent-badge ent-badge--ok">connected</span>`
                    : html`<span class="ent-badge ent-badge--error">disconnected</span>`}
                </span>
              </div>
              ${status?.subsystems.cluster.detail
                ? html`
                    <div class="muted" style="margin-top:8px;font-size:12px">
                      ${status.subsystems.cluster.detail}
                    </div>
                  `
                : nothing}
            </section>
          `
        : nothing}
      ${tenancyEnabled
        ? html`
            <section class="ent-section" style="margin-top:24px">
              <h3 class="ent-section-title">Multi-tenancy</h3>
              <div class="ent-kv-grid">
                <span class="ent-kv-key">Active tenants</span>
                <span class="ent-kv-val">${metrics?.tenantCount ?? "—"}</span>
                <span class="ent-kv-key">Isolation</span>
                <span class="ent-kv-val">AsyncLocalStorage context propagation</span>
              </div>
              <div class="muted" style="margin-top:12px;font-size:13px">
                Tenant context is automatically propagated through all async operations without
                manual threading. Configure tenants under
                <code>enterprise.tenancy.tenants[]</code> in your config.
              </div>
            </section>
          `
        : nothing}
    </div>
  `;
}

// ── Settings ──────────────────────────────────────────────────────────────────

function roleRow(role: string, description: string) {
  const icon = role === "admin" ? "🔑" : role === "operator" ? "🔧" : "👁️";
  return html`
    <div class="ent-defense-row">
      <span class="ent-defense-icon">${icon}</span>
      <div class="ent-defense-body">
        <span class="ent-defense-label"><code>${role}</code></span>
        <span class="ent-defense-desc muted">${description}</span>
      </div>
      <span class="ent-defense-state">
        <span class="ent-badge ent-badge--info">built-in</span>
      </span>
    </div>
  `;
}

function renderEnterpriseSettings(props: EnterpriseAdminProps) {
  const { dashboardTitle, dashboardTagline } = props;

  function handleSaveBranding(e: Event) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const title = (form.elements.namedItem("title") as HTMLInputElement).value.trim();
    const tagline = (form.elements.namedItem("tagline") as HTMLInputElement).value.trim();
    props.onDashboardSettingsChange(title, tagline);
  }

  function handleResetBranding() {
    props.onDashboardSettingsChange("", "");
  }

  return html`
    <div class="ent-settings">
      <section class="ent-section">
        <h3 class="ent-section-title">Dashboard branding</h3>
        <p class="muted" style="font-size:12px;margin:0 0 12px">
          Customize the brand title and tagline for this browser. Leave blank to use the defaults
          (<em>OpenClaw</em> / <em>Enterprise Gateway</em>).
        </p>
        <form @submit=${handleSaveBranding} style="display:flex;flex-direction:column;gap:10px">
          <div class="ent-field-row">
            <label class="ent-field-label" for="ent-title">Dashboard title</label>
            <input
              id="ent-title"
              name="title"
              class="ent-input"
              type="text"
              placeholder="OpenClaw Enterprise"
              maxlength="48"
              .value=${dashboardTitle}
            />
          </div>
          <div class="ent-field-row">
            <label class="ent-field-label" for="ent-tagline">Tagline</label>
            <input
              id="ent-tagline"
              name="tagline"
              class="ent-input"
              type="text"
              placeholder="Enterprise Gateway"
              maxlength="64"
              .value=${dashboardTagline}
            />
          </div>
          <div style="display:flex;gap:8px;margin-top:4px">
            <button type="submit" class="ent-btn-sm ent-btn-sm--primary">Save branding</button>
            <button
              type="button"
              class="ent-btn-sm"
              @click=${handleResetBranding}
              title="Restore default OpenClaw Enterprise branding"
            >
              Reset to defaults
            </button>
          </div>
        </form>
      </section>

      <section class="ent-section" style="margin-top:24px">
        <h3 class="ent-section-title">Available roles</h3>
        <p class="muted" style="font-size:12px;margin:0 0 10px">
          These built-in roles are assignable to users in the Users &amp; roles tab. Custom roles
          can be defined in <code>enterprise.iam.roles[]</code> in your config.
        </p>
        <div class="ent-defense-list">
          ${roleRow("admin", "Full access — can manage config, users, agents, and all settings.")}
          ${roleRow(
            "operator",
            "Can run agents, manage sessions, cron jobs, and channels. Cannot change IAM or config.",
          )}
          ${roleRow("viewer", "Read-only access to sessions, usage stats, and audit log.")}
        </div>
      </section>

      <section class="ent-section" style="margin-top:24px">
        <h3 class="ent-section-title">Permission model</h3>
        <div class="ent-kv-grid" style="font-size:12px">
          <span class="ent-kv-key">Inheritance</span>
          <span class="ent-kv-val"
            >Roles are additive — a user with multiple roles gets the union of all
            permissions.</span
          >
          <span class="ent-kv-key">Wildcards</span>
          <span class="ent-kv-val"
            >Custom roles support wildcard patterns, e.g. <code>agents:*</code> or
            <code>sessions:read</code>.</span
          >
          <span class="ent-kv-key">Groups</span>
          <span class="ent-kv-val"
            >Users inherit all roles from their groups — useful for team-based access control.</span
          >
          <span class="ent-kv-key">Enforcement</span>
          <span class="ent-kv-val"
            >Every gateway API call is checked against the IAM engine before execution.</span
          >
        </div>
        <div style="margin-top:12px">
          <a
            class="ent-link"
            href="https://github.com/mholovetskyi/openclawenterprise/blob/main/docs/enterprise/iam.md"
            target="_blank"
            rel="noreferrer"
            >Full IAM & RBAC documentation →</a
          >
        </div>
      </section>
    </div>
  `;
}
