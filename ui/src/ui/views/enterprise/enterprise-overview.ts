import { html, nothing } from "lit";
import type { EnterpriseAdminProps, SubsystemStatus } from "./types.js";

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

export function renderEnterpriseOverview(props: EnterpriseAdminProps) {
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
      <!-- Subsystem health grid -->
      <section class="ent-section">
        <h3 class="ent-section-title">Subsystems</h3>
        <div class="ent-subsystem-grid">
          ${subsystemRow("🔐", "Secrets", ss.secrets)}
          ${subsystemRow("👤", "IAM / RBAC", ss.iam)}
          ${subsystemRow("📋", "Audit logging", ss.audit)}
          ${subsystemRow("📊", "Monitoring", ss.monitoring)}
          ${subsystemRow("🏢", "Multi-tenancy", ss.tenancy)}
          ${subsystemRow("🔗", "Cluster", ss.cluster)}
        </div>
      </section>

      <!-- Metrics cards -->
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
                ${ss.tenancy.enabled
                  ? metricCard("Tenants", metrics.tenantCount)
                  : nothing}
                ${ss.cluster.enabled
                  ? metricCard("Cluster nodes", metrics.clusterNodeCount)
                  : nothing}
              </div>
            </section>
          `
        : nothing}

      <!-- Node info -->
      <section class="ent-section">
        <h3 class="ent-section-title">Instance</h3>
        <div class="ent-kv-grid">
          <span class="ent-kv-key">Node ID</span>
          <span class="ent-kv-val">
            <code>${status.nodeId ?? "—"}</code>
          </span>
          <span class="ent-kv-key">Version</span>
          <span class="ent-kv-val"><code>${status.version}</code></span>
        </div>
      </section>
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
