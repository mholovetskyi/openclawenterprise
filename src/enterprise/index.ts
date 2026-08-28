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

export async function initEnterprise(cfg: OpenClawConfig): Promise<EnterpriseHandle> {
  if (!isEnterpriseEnabled(cfg)) {
    return { shutdown: async () => {} };
  }

  const shutdowns: Array<() => Promise<void>> = [];

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
