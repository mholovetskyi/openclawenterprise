import { html, nothing } from "lit";
import type { EnterpriseAdminProps, RbacUser } from "./types.js";
import { BUILTIN_ROLES } from "./types.js";

export function renderEnterpriseUsers(props: EnterpriseAdminProps) {
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
                    editingUserId === u.id
                      ? renderEditRow(u, props)
                      : renderViewRow(u, props),
                  )}
                </tbody>
              </table>
            </div>
            <p class="muted" style="font-size:11px;margin-top:8px">
              Click <strong>Edit</strong> to change a user's roles or active status.
              Changes are written to the gateway via the IAM API when connected.
            </p>
          `
        : nothing}
    </div>
  `;
}

function renderViewRow(u: RbacUser, props: EnterpriseAdminProps) {
  return html`
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
      <td>
        <button
          class="ent-btn-sm"
          @click=${() => props.onStartEditUser(u.id, [...u.roles], u.active)}
          title="Edit roles and status for ${u.displayName ?? u.id}"
        >
          Edit
        </button>
      </td>
    </tr>
  `;
}

function renderEditRow(u: RbacUser, props: EnterpriseAdminProps) {
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
      <td>${u.displayName ?? html`<span class="muted">—</span>`}</td>
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
          <button
            class="ent-btn-sm"
            @click=${props.onCancelUserEdit}
            title="Discard changes"
          >
            Cancel
          </button>
        </div>
      </td>
    </tr>
  `;
}

function renderPillList(items: string[], type: string) {
  if (items.length === 0) {return html`<span class="muted">—</span>`;}
  return html`
    <span class="ent-pill-list">
      ${items.map(
        (item) => html`<span class="ent-pill ent-pill--${type}">${item}</span>`,
      )}
    </span>
  `;
}
