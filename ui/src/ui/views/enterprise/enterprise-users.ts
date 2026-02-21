import { html, nothing } from "lit";
import type { EnterpriseAdminProps, RbacUser } from "./types.js";

export function renderEnterpriseUsers(props: EnterpriseAdminProps) {
  const { users, usersLoading } = props;

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
                  </tr>
                </thead>
                <tbody>
                  ${users.map(
                    (u) => html`
                      <tr class=${u.active ? "" : "ent-row--inactive"}>
                        <td class="mono ent-td-truncate">${u.id}</td>
                        <td>${u.displayName ?? html`<span class="muted">—</span>`}</td>
                        <td class="muted">${u.email ?? "—"}</td>
                        <td>${renderPillList(u.roles, "role")}</td>
                        <td>${renderPillList(u.groups, "group")}</td>
                        <td>
                          ${u.active
                            ? html`<span class="ent-badge ent-badge--ok">active</span>`
                            : html`<span class="ent-badge ent-badge--disabled">inactive</span>`}
                        </td>
                      </tr>
                    `,
                  )}
                </tbody>
              </table>
            </div>
          `
        : nothing}
    </div>
  `;
}

function renderPillList(items: string[], type: string) {
  if (items.length === 0) return html`<span class="muted">—</span>`;
  return html`
    <span class="ent-pill-list">
      ${items.map(
        (item) => html`<span class="ent-pill ent-pill--${type}">${item}</span>`,
      )}
    </span>
  `;
}
