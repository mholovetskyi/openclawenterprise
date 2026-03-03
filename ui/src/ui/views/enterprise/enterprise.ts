/**
 * Enterprise admin dashboard — main entry point.
 *
 * Renders the enterprise tab shell with sub-tabs:
 *   overview | users | audit | security | cluster
 *
 * Usage (add to app-render.ts alongside other tabs):
 *   import { renderEnterprise } from "./views/enterprise/enterprise.js";
 */
import { html, nothing } from "lit";
import { renderEnterpriseAudit } from "./enterprise-audit.js";
import { renderEnterpriseCluster } from "./enterprise-cluster.js";
import { renderEnterpriseOverview } from "./enterprise-overview.js";
import { renderEnterpriseSecurity } from "./enterprise-security.js";
import { renderEnterpriseSettings } from "./enterprise-settings.js";
import { renderEnterpriseUsers } from "./enterprise-users.js";
import type { EnterpriseAdminProps, EnterpriseTab } from "./types.js";

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
      <style>
        ${enterpriseStyles}
      </style>
      <div class="ent-header">
        <span class="ent-header-title">🦞 Enterprise</span>
        ${
          props.status?.version
            ? html`<span class="ent-header-version muted">v${props.status.version}</span>`
            : nothing
        }
      </div>

      <!-- Sub-tab bar -->
      <nav class="ent-tabs" role="tablist">
        ${TABS.map(
          (tab) => html`
            <button
              class="ent-tab ${props.activeTab === tab.id ? "ent-tab--active" : ""}"
              role="tab"
              aria-selected=${props.activeTab === tab.id}
              @click=${() => props.onTabChange(tab.id)}
            >
              <span class="ent-tab-icon">${tab.icon}</span>
              <span class="ent-tab-label">${tab.label}</span>
            </button>
          `,
        )}
      </nav>

      <!-- Tab content -->
      <div class="ent-content" role="tabpanel">
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

// ── Scoped styles (injected once via <style> tag) ──────────────────────────
// Uses CSS custom properties that inherit from the app's theme.
const enterpriseStyles = `
  .ent-shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    font-size: 13px;
    color: var(--color-text, #e2e2e2);
  }
  .ent-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 12px 16px 8px;
    border-bottom: 1px solid var(--color-border, #333);
  }
  .ent-header-title { font-size: 15px; font-weight: 600; }
  .ent-header-version { font-size: 11px; }

  /* Sub-tab bar */
  .ent-tabs {
    display: flex;
    gap: 2px;
    padding: 6px 12px 0;
    border-bottom: 1px solid var(--color-border, #333);
    overflow-x: auto;
  }
  .ent-tab {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--color-muted, #888);
    cursor: pointer;
    font-size: 12px;
    white-space: nowrap;
    transition: color 0.1s, border-color 0.1s;
  }
  .ent-tab:hover { color: var(--color-text, #e2e2e2); }
  .ent-tab--active {
    color: var(--color-text, #e2e2e2);
    border-bottom-color: var(--color-accent, #4dabf7);
    font-weight: 500;
  }

  .ent-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }

  /* Sections */
  .ent-section { margin-bottom: 20px; }
  .ent-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .ent-section-title {
    font-size: 13px;
    font-weight: 600;
    margin: 0 0 8px;
    color: var(--color-text, #e2e2e2);
  }
  .ent-section-subtitle {
    font-size: 12px;
    font-weight: 600;
    margin: 0 0 8px;
    color: var(--color-muted, #888);
  }

  /* Badges */
  .ent-badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    line-height: 18px;
  }
  .ent-badge--ok { background: #1a3a1a; color: #6bcb6b; }
  .ent-badge--error { background: #3a1a1a; color: #e06c6c; }
  .ent-badge--warn { background: #3a2a0a; color: #e0b050; }
  .ent-badge--info { background: #1a2a3a; color: #5ab0e0; }
  .ent-badge--disabled { background: #2a2a2a; color: #666; }

  /* Subsystem grid */
  .ent-subsystem-grid { display: flex; flex-direction: column; gap: 4px; }
  .ent-subsystem-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: 4px;
  }
  .ent-subsystem-icon { width: 20px; text-align: center; }
  .ent-subsystem-label { flex: 1; }
  .ent-subsystem-detail { font-size: 11px; }

  /* Metrics grid */
  .ent-metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 8px;
  }
  .ent-metric-card {
    background: var(--color-surface, #1e1e1e);
    border: 1px solid var(--color-border, #333);
    border-radius: 6px;
    padding: 10px 12px;
  }
  .ent-metric-value { font-size: 20px; font-weight: 700; line-height: 1.2; }
  .ent-metric-label { font-size: 11px; color: var(--color-muted, #888); margin-top: 2px; }
  .ent-metric-sub { font-size: 11px; color: var(--color-muted, #777); margin-top: 1px; }

  /* KV grid */
  .ent-kv-grid {
    display: grid;
    grid-template-columns: 160px 1fr;
    gap: 4px 12px;
    align-items: baseline;
  }
  .ent-kv-key { color: var(--color-muted, #888); font-size: 12px; }
  .ent-kv-val { font-size: 12px; }

  /* Tables */
  .ent-table-wrap { overflow-x: auto; }
  .ent-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .ent-table th {
    text-align: left;
    font-weight: 600;
    color: var(--color-muted, #888);
    padding: 4px 8px;
    border-bottom: 1px solid var(--color-border, #333);
    white-space: nowrap;
  }
  .ent-table td {
    padding: 5px 8px;
    border-bottom: 1px solid var(--color-border-subtle, #262626);
    vertical-align: top;
  }
  .ent-table tr:hover td { background: var(--color-hover, #1a1a1a); }
  .ent-row--inactive td { opacity: 0.5; }
  .ent-td-ts { white-space: nowrap; }
  .ent-td-truncate { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ent-table-footer { margin-top: 8px; font-size: 11px; }

  /* Buttons */
  .ent-btn-sm {
    padding: 3px 8px;
    font-size: 11px;
    background: var(--color-surface, #1e1e1e);
    border: 1px solid var(--color-border, #333);
    border-radius: 4px;
    color: var(--color-muted, #888);
    cursor: pointer;
  }
  .ent-btn-sm:hover:not(:disabled) { color: var(--color-text, #e2e2e2); }
  .ent-btn-sm:disabled { opacity: 0.5; cursor: not-allowed; }

  /* Empty state */
  .ent-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 40px 24px;
    gap: 8px;
    color: var(--color-muted, #888);
  }
  .ent-empty-icon { font-size: 32px; }
  .ent-empty-title { font-size: 14px; font-weight: 600; color: var(--color-text, #e2e2e2); }
  .ent-empty-body { font-size: 12px; max-width: 360px; }

  /* Loading */
  .ent-loading { padding: 24px; text-align: center; color: var(--color-muted, #888); }

  /* Pills */
  .ent-pill-list { display: flex; flex-wrap: wrap; gap: 3px; }
  .ent-pill {
    display: inline-block;
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 11px;
  }
  .ent-pill--role { background: #1a2a3a; color: #5ab0e0; }
  .ent-pill--group { background: #2a1a3a; color: #b07ae0; }

  /* Alerts */
  .ent-alert-row { display: flex; flex-direction: column; gap: 8px; }
  .ent-alert {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
  }
  .ent-alert--ok { background: #1a3a1a; border: 1px solid #2a4a2a; }
  .ent-alert--warn { background: #3a2a0a; border: 1px solid #4a3a1a; }
  .ent-alert--info { background: #1a2a3a; border: 1px solid #2a3a4a; }
  .ent-alert--error { background: #3a1a1a; border: 1px solid #4a2a2a; }

  /* Defense list */
  .ent-defense-list { display: flex; flex-direction: column; gap: 4px; }
  .ent-defense-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 4px;
  }
  .ent-defense-row--inactive { opacity: 0.5; }
  .ent-defense-icon { width: 20px; text-align: center; }
  .ent-defense-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ent-defense-label { font-weight: 500; }
  .ent-defense-desc { font-size: 11px; }
  .ent-defense-state { flex-shrink: 0; }

  /* Form fields (settings tab) */
  .ent-field-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .ent-field-label {
    font-size: 12px;
    color: var(--color-muted, #888);
    font-weight: 500;
  }
  .ent-input {
    width: 100%;
    max-width: 360px;
    padding: 6px 10px;
    font-size: 13px;
    background: var(--color-surface, #1e1e1e);
    border: 1px solid var(--color-border, #333);
    border-radius: 4px;
    color: var(--color-text, #e2e2e2);
    font-family: inherit;
    box-sizing: border-box;
    outline: none;
    transition: border-color 0.1s;
  }
  .ent-input:focus {
    border-color: var(--color-accent, #4dabf7);
  }
  .ent-input::placeholder {
    color: var(--color-muted, #888);
  }
  .ent-btn-sm--primary {
    background: var(--color-accent, #4dabf7);
    border-color: var(--color-accent, #4dabf7);
    color: #000;
    font-weight: 600;
  }
  .ent-btn-sm--primary:hover:not(:disabled) {
    opacity: 0.85;
    color: #000;
  }

  /* Inline edit row in users table */
  .ent-edit-row td {
    background: var(--color-surface, #1e1e1e);
    vertical-align: middle;
  }
  .ent-role-checkboxes {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .ent-role-check {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    cursor: pointer;
  }
  .ent-active-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    cursor: pointer;
  }
  .ent-edit-actions {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  /* Links */
  .ent-link {
    display: inline-block;
    color: var(--color-accent, #4dabf7);
    text-decoration: none;
    font-size: 12px;
    margin: 4px 0;
  }
  .ent-link:hover { text-decoration: underline; }
  .ent-link-list { display: flex; flex-direction: column; gap: 2px; }

  /* Overview */
  .ent-overview { display: flex; flex-direction: column; gap: 0; }

  .muted { color: var(--color-muted, #888); }
  .mono { font-family: var(--font-mono, monospace); }
`;

export type { EnterpriseAdminProps, EnterpriseTab } from "./types.js";
