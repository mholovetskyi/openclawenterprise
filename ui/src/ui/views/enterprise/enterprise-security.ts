import { html } from "lit";
import type { EnterpriseAdminProps } from "./types.js";

export function renderEnterpriseSecurity(props: EnterpriseAdminProps) {
  const { status, metrics } = props;
  const guardrailBlocks = metrics?.guardrailBlocksTotal ?? 0;
  const authFailures = metrics?.authFailureTotal ?? 0;

  return html`
    <div class="ent-security">
      <h3 class="ent-section-title">Security dashboard</h3>

      <!-- Alert cards -->
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

      <!-- Feature status -->
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

      <!-- Links -->
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
