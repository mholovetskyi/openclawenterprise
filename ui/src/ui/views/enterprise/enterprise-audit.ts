import { html, nothing } from "lit";
import type { EnterpriseAdminProps, AuditEventRow } from "./types.js";

function outcomeChip(outcome: AuditEventRow["outcome"]) {
  const map = {
    success: html`
      <span class="ent-badge ent-badge--ok">success</span>
    `,
    failure: html`
      <span class="ent-badge ent-badge--error">failure</span>
    `,
    blocked: html`
      <span class="ent-badge ent-badge--warn">blocked</span>
    `,
  };
  return map[outcome] ?? nothing;
}

function formatTs(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ").slice(0, 19);
}

export function renderEnterpriseAudit(props: EnterpriseAdminProps) {
  const { auditEvents, auditLoading } = props;

  return html`
    <div class="ent-audit">
      <div class="ent-section-header">
        <h3 class="ent-section-title">Audit log</h3>
        <button class="ent-btn-sm" @click=${props.onRefreshAudit} ?disabled=${auditLoading}>
          ${auditLoading ? "Loading…" : "↻ Refresh"}
        </button>
      </div>

      ${
        auditLoading && auditEvents.length === 0
          ? html`
              <div class="ent-loading">Loading audit events…</div>
            `
          : nothing
      }
      ${
        !auditLoading && auditEvents.length === 0
          ? html`
              <div class="ent-empty">
                <div class="ent-empty-title">No audit events yet</div>
                <div class="ent-empty-body">
                  Events are recorded as you use OpenClaw with enterprise audit logging enabled.
                </div>
              </div>
            `
          : nothing
      }
      ${
        auditEvents.length > 0
          ? html`
            <div class="ent-table-wrap">
              <table class="ent-table">
                <thead>
                  <tr>
                    <th>Time (UTC)</th>
                    <th>Action</th>
                    <th>Actor</th>
                    <th>Resource</th>
                    ${
                      auditEvents.some((e) => e.tenantId)
                        ? html`
                            <th>Tenant</th>
                          `
                        : nothing
                    }
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
                        ${
                          auditEvents.some((e) => e.tenantId)
                            ? html`<td class="muted">${ev.tenantId ?? "—"}</td>`
                            : nothing
                        }
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
          : nothing
      }
    </div>
  `;
}
