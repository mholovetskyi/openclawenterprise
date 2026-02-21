import { html, nothing } from "lit";
import type { EnterpriseAdminProps } from "./types.js";

export function renderEnterpriseCluster(props: EnterpriseAdminProps) {
  const { status, metrics } = props;
  const clusterEnabled = status?.subsystems.cluster.enabled ?? false;
  const tenancyEnabled = status?.subsystems.tenancy.enabled ?? false;

  if (!clusterEnabled && !tenancyEnabled) {
    return html`
      <div class="ent-empty">
        <div class="ent-empty-icon">🔗</div>
        <div class="ent-empty-title">Cluster &amp; tenancy not enabled</div>
        <div class="ent-empty-body">
          Enable <code>enterprise.cluster.enabled: true</code> for distributed multi-node mode
          and <code>enterprise.tenancy.enabled: true</code> for multi-tenant isolation.
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
