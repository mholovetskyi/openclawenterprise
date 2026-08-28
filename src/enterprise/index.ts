/**
 * Enterprise subsystem — zero-overhead when disabled.
 *
 * All enterprise modules are lazily imported so they add no startup cost
 * to the default community install.
 *
 * Activation: set `enterprise.enabled: true` in config.yaml.
 */

import type { OpenClawConfig } from "../config/config.js";

export type EnterpriseHandle = {
  shutdown: () => Promise<void>;
};

let handle: EnterpriseHandle | null = null;

export function isEnterpriseEnabled(cfg: OpenClawConfig): boolean {
  return cfg.enterprise?.enabled === true;
}

/**
 * Startup enforcement-gap check — the "don't give false confidence" safeguard.
 *
 * Some enterprise controls are declared in config but their request-path
 * enforcement is not wired in this build (the enforcement needs caller identity
 * / a multi-step protocol / request-entry context that initEnterprise cannot
 * safely add). When such a control is turned on, we must not boot silently as if
 * it were active:
 *   - WARN prominently for controls whose absence degrades (but does not defeat)
 *     a security posture (tenancy limits, NVIDIA guardrails, OIDC login).
 *   - THROW (fail closed, refuse to boot) for the most dangerous controls where a
 *     silent no-op is actively dangerous (MFA at authentication).
 *
 * Default community install (enterprise disabled) and basic enterprise use
 * (these advanced flags unset) are unaffected — nothing here fires.
 */
export function assertEnterpriseEnforcementWired(cfg: OpenClawConfig): void {
  const ent = cfg.enterprise;
  if (!ent) return;

  // ── MFA — DANGEROUS: fail closed ────────────────────────────────────────────
  // MfaService.verify is only reachable via the admin-gated mfa RPCs; no
  // login/token-issuance path demands a second factor. Booting with MFA "on"
  // but never challenged is worse than off: it grants false assurance that a
  // stolen password/IdP assertion is insufficient. Refuse to boot.
  const mfa = ent.auth?.mfa;
  const mfaRequested =
    mfa?.enabled === true ||
    (Array.isArray(mfa?.requireForRoles) && mfa.requireForRoles.length > 0);
  if (mfaRequested) {
    throw new Error(
      "[enterprise] MFA is configured (enterprise.auth.mfa) but is NOT enforced at authentication " +
        "in this build: no login/token-issuance path challenges for a TOTP code, so the second " +
        "factor is never demanded. Refusing to boot rather than give false assurance. Remove " +
        "enterprise.auth.mfa (enabled/requireForRoles) until MFA is wired into the auth/token-issuance path.",
    );
  }

  // ── Per-tenant limits / allowedModels — WARN ────────────────────────────────
  // TenantLimits + rateLimits are registered into the TenantRegistry but no code
  // reads them to gate model use, spend, or request rate (tenant context is also
  // never established on the request path). Warn so operators do not rely on them.
  if (ent.tenancy?.enabled) {
    const anyLimits = (ent.tenancy.tenants ?? []).some(
      (t) =>
        (t.limits && Object.keys(t.limits).length > 0) ||
        (t.limits?.allowedModels && t.limits.allowedModels.length > 0) ||
        t.rateLimits?.requestsPerMinute !== undefined,
    );
    if (anyLimits) {
      console.warn(
        "[enterprise] Per-tenant limits/allowedModels/rateLimits are configured " +
          "(enterprise.tenancy.tenants[].limits) but are NOT enforced in this build: no model-selection, " +
          "token-accounting, or request-admission path reads them, and tenant context is not established " +
          "on the request path. These quotas/allowlists do nothing right now.",
      );
    }
  }

  // ── NVIDIA guardrails (block/enforcing rules) — WARN ────────────────────────
  // guardrails.nvidia (thinking-budget limit, cost guard, model-routing policy)
  // has no caller in the model-selection / NIM request path, so its block/
  // require-approval decisions never fire and cost usage never accumulates.
  const nv = ent.guardrails?.nvidia;
  const nvRequested =
    nv?.thinkingBudgetLimit?.enabled === true ||
    nv?.costGuard?.enabled === true ||
    nv?.modelRoutingPolicy?.enabled === true;
  if (nvRequested) {
    console.warn(
      "[enterprise] NVIDIA guardrails are configured (enterprise.guardrails.nvidia: " +
        "thinkingBudgetLimit/costGuard/modelRoutingPolicy) but are NOT enforced in this build: the " +
        "model-selection / NIM request path never calls evaluateNvidiaGuardrails, so block/require-approval " +
        "decisions do not fire and cost-guard usage always reads zero.",
    );
  }

  // ── OIDC login — WARN ───────────────────────────────────────────────────────
  // OidcService is never initialized by initEnterprise; enabling OIDC in config
  // does not activate a login flow. (Both iam.oidc and auth.oidc are inert here.)
  const oidcRequested = ent.iam?.oidc?.enabled === true || ent.auth?.oidc?.enabled === true;
  if (oidcRequested) {
    console.warn(
      "[enterprise] OIDC is configured (enterprise.iam.oidc / enterprise.auth.oidc) but the OIDC " +
        "service is NOT initialized in this build: no OIDC login/callback flow is wired, so enabling it " +
        "here has no effect. Users cannot authenticate via OIDC through this layer.",
    );
  }
}

export async function initEnterprise(cfg: OpenClawConfig): Promise<EnterpriseHandle> {
  if (!isEnterpriseEnabled(cfg)) {
    return { shutdown: async () => {} };
  }

  // Refuse to boot / warn loudly when a configured control is not actually
  // enforced in this build. Runs first so a dangerous misconfig fails before any
  // subsystem starts.
  assertEnterpriseEnforcementWired(cfg);

  const shutdowns: Array<() => Promise<void>> = [];

  // ── Runtime guardrails ──────────────────────────────────────────────────────
  // Load config-declared guardrail rules into the global engine BEFORE any tool
  // call can occur, so agent-tools.before-tool-call.policy.ts sees them. Gated
  // on guardrails.enabled !== false (default-on when enterprise is enabled).
  if (cfg.enterprise?.guardrails?.enabled !== false) {
    const {
      buildGuardrailRulesFromConfig,
      GuardrailEngine,
      setGuardrailEngine,
      DEFAULT_GUARDRAIL_RULES,
    } = await import("./security/guardrails.js");
    const { rules, errors } = buildGuardrailRulesFromConfig(cfg.enterprise?.guardrails?.rules);
    for (const e of errors) {
      console.warn(`[enterprise/guardrails] skipping invalid rule ${e.id}: ${e.error}`);
    }
    setGuardrailEngine(new GuardrailEngine([...DEFAULT_GUARDRAIL_RULES, ...rules]));
    // Restore the default engine on shutdown so configured rules don't leak
    // across re-inits within a single process.
    shutdowns.push(async () => {
      setGuardrailEngine(new GuardrailEngine());
    });
  }

  // ── Secrets ────────────────────────────────────────────────────────────────
  // No `enabled` flag on EnterpriseSecretsConfig — `backend: "none"` opts out.
  if (cfg.enterprise?.secrets?.backend !== "none") {
    const { initSecretsBackend } = await import("./secrets/index.js");
    const s = await initSecretsBackend(cfg);
    shutdowns.push(s.shutdown);
  }

  // ── IAM / RBAC ─────────────────────────────────────────────────────────────
  if (cfg.enterprise?.iam?.enabled !== false) {
    const { initIAM } = await import("./iam/index.js");
    const iam = await initIAM(cfg);
    shutdowns.push(iam.shutdown);
  }

  // ── Audit logging ──────────────────────────────────────────────────────────
  if (cfg.enterprise?.audit?.enabled !== false) {
    const { initAudit } = await import("./audit/index.js");
    const audit = await initAudit(cfg);
    shutdowns.push(audit.shutdown);
  }

  // ── Monitoring ─────────────────────────────────────────────────────────────
  if (cfg.enterprise?.monitoring?.enabled !== false) {
    const { initMonitoring } = await import("./monitoring/index.js");
    const mon = await initMonitoring(cfg);
    shutdowns.push(mon.shutdown);
  }

  // ── Multi-tenancy ──────────────────────────────────────────────────────────
  if (cfg.enterprise?.tenancy?.enabled) {
    const { initTenancy } = await import("./tenancy/index.js");
    const ten = await initTenancy(cfg);
    shutdowns.push(ten.shutdown);
  }

  // ── Cluster ────────────────────────────────────────────────────────────────
  if (cfg.enterprise?.cluster?.enabled) {
    const { initCluster } = await import("./cluster/index.js");
    const cl = await initCluster(cfg);
    shutdowns.push(cl.shutdown);
  }

  // ── NVIDIA NIM ───────────────────────────────────────────────────────────
  if (cfg.enterprise?.nvidia?.nim?.enabled) {
    const { initNimProvider } = await import("./nvidia/nim-provider.js");
    const nim = await initNimProvider(cfg);
    shutdowns.push(() => nim.shutdown());
  }

  // ── NVIDIA GPU Metrics ──────────────────────────────────────────────────
  if (cfg.enterprise?.nvidia?.gpuMetrics?.enabled) {
    const { initGpuMetrics } = await import("./nvidia/gpu-metrics.js");
    const gpu = await initGpuMetrics(cfg);
    shutdowns.push(() => gpu.shutdown());
  }

  // ── NVIDIA NemoClaw ─────────────────────────────────────────────────────
  if (cfg.enterprise?.nvidia?.nemoClaw?.enabled) {
    const { initNemoClawProvider } = await import("./nvidia/nemoclaw-provider.js");
    const nc = await initNemoClawProvider(cfg);
    shutdowns.push(() => nc.shutdown());
  }

  handle = {
    shutdown: async () => {
      for (const fn of shutdowns.toReversed()) {
        try {
          await fn();
        } catch {
          // best-effort shutdown
        }
      }
    },
  };

  return handle;
}

export function getEnterpriseHandle(): EnterpriseHandle | null {
  return handle;
}
