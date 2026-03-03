import { html } from "lit";
import type { EnterpriseAdminProps } from "./types.js";
import { BUILTIN_ROLES } from "./types.js";

export function renderEnterpriseSettings(props: EnterpriseAdminProps) {
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

      <!-- Dashboard branding -->
      <section class="ent-section">
        <h3 class="ent-section-title">Dashboard branding</h3>
        <p class="muted" style="font-size:12px;margin:0 0 12px">
          Customize the title and tagline shown in the top-left corner of every dashboard page.
          Leave blank to use the defaults (<em>OPENCLAW Enterprise</em> /
          <em>Enterprise Gateway</em>).
        </p>
        <form @submit=${handleSaveBranding} style="display:flex;flex-direction:column;gap:10px">
          <div class="ent-field-row">
            <label class="ent-field-label" for="ent-title">Dashboard title</label>
            <input
              id="ent-title"
              name="title"
              class="ent-input"
              type="text"
              placeholder="OPENCLAW Enterprise"
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
              title="Restore default OPENCLAW Enterprise branding"
            >
              Reset to defaults
            </button>
          </div>
        </form>
      </section>

      <!-- Roles reference -->
      <section class="ent-section" style="margin-top:24px">
        <h3 class="ent-section-title">Available roles</h3>
        <p class="muted" style="font-size:12px;margin:0 0 10px">
          These built-in roles are assignable to users in the Users &amp; roles tab.
          Custom roles can be defined in <code>enterprise.iam.roles[]</code> in your config.
        </p>
        <div class="ent-defense-list">
          ${roleRow("admin", "Full access — can manage config, users, agents, and all settings.")}
          ${roleRow("operator", "Can run agents, manage sessions, cron jobs, and channels. Cannot change IAM or config.")}
          ${roleRow("viewer", "Read-only access to sessions, usage stats, and audit log.")}
        </div>
      </section>

      <!-- Permissions note -->
      <section class="ent-section" style="margin-top:24px">
        <h3 class="ent-section-title">Permission model</h3>
        <div class="ent-kv-grid" style="font-size:12px">
          <span class="ent-kv-key">Inheritance</span>
          <span class="ent-kv-val">Roles are additive — a user with multiple roles gets the union of all permissions.</span>
          <span class="ent-kv-key">Wildcards</span>
          <span class="ent-kv-val">Custom roles support wildcard patterns, e.g. <code>agents:*</code> or <code>sessions:read</code>.</span>
          <span class="ent-kv-key">Groups</span>
          <span class="ent-kv-val">Users inherit all roles from their groups — useful for team-based access control.</span>
          <span class="ent-kv-key">Enforcement</span>
          <span class="ent-kv-val">Every gateway API call is checked against the IAM engine before execution.</span>
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

// Suppress unused import warning — BUILTIN_ROLES is exported from types and
// used by enterprise-users.ts; imported here for co-location clarity.
void (BUILTIN_ROLES as unknown);
