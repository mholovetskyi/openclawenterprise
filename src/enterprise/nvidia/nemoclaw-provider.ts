/**
 * NVIDIA NemoClaw Enterprise — sandboxed inference with OpenShell.
 *
 * NemoClaw wraps OpenClaw in an NVIDIA OpenShell sandbox with declarative
 * security policies and inference routing. Supports three inference profiles:
 *   - nvidia-cloud: Nemotron 3 Super 120B via integrate.api.nvidia.com
 *   - local-nim: Self-hosted NIM container
 *   - vllm: Self-hosted vLLM endpoint
 *
 * Activation: enterprise.nvidia.nemoClaw.enabled: true
 */

import type { OpenClawConfig } from "../../config/config.js";
import type {
  EnterpriseNemoClawConfig,
  NemoClawInferenceProfile,
  NimModelConfig,
} from "../../config/types.enterprise.js";
import { auditLogSync } from "../audit/logger.js";
import { metrics } from "../monitoring/metrics.js";
import { resolveSecretValue } from "../secrets/index.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type NemoClawModel = {
  id: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  inferenceProfile: NemoClawInferenceProfile;
};

export type NemoClawRequestOptions = {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens?: number;
  temperature?: number;
  tools?: unknown[];
};

export type NemoClawResponse = {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string | null; tool_calls?: unknown[] };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type NemoClawSandboxStatus = {
  running: boolean;
  profile: NemoClawInferenceProfile;
  policyLoaded: boolean;
  egressBlocked: number;
  egressAllowed: number;
};

export type NemoClawHealthStatus = {
  healthy: boolean;
  endpoint: string;
  sandboxStatus: NemoClawSandboxStatus;
  lastCheckMs: number;
  error?: string;
};

export type NemoClawProviderHandle = {
  chatCompletion(opts: NemoClawRequestOptions): Promise<NemoClawResponse>;
  getModels(): NemoClawModel[];
  getModel(id: string): NemoClawModel | null;
  getHealthStatus(): NemoClawHealthStatus;
  getSandboxStatus(): NemoClawSandboxStatus;
  isHealthy(): boolean;
  shutdown(): Promise<void>;
};

// ── Default models ───────────────────────────────────────────────────────────

const NEMOCLAW_DEFAULT_MODELS: NimModelConfig[] = [
  {
    id: "nvidia/nemotron-3-super-120b-a12b",
    displayName: "Nemotron 3 Super 120B",
    contextWindow: 131072,
    maxOutputTokens: 32768,
    capabilities: ["chat", "tool-calling", "reasoning", "multi-agent"],
    thinkingBudget: "configurable",
  },
  {
    id: "nvidia/nemotron-3-nano-30b-a3b",
    displayName: "Nemotron 3 Nano 30B",
    contextWindow: 1048576,
    maxOutputTokens: 32768,
    capabilities: ["chat", "tool-calling", "reasoning"],
    thinkingBudget: "configurable",
  },
  {
    id: "nvidia/llama-3.3-nemotron-super-49b-v1",
    displayName: "Nemotron 3 Super 49B",
    contextWindow: 131072,
    maxOutputTokens: 32768,
    capabilities: ["chat", "tool-calling", "reasoning", "multi-agent"],
  },
];

const INFERENCE_ENDPOINTS: Record<NemoClawInferenceProfile, string> = {
  "nvidia-cloud": "https://integrate.api.nvidia.com/v1",
  "local-nim": "http://localhost:8000/v1",
  vllm: "http://localhost:8000/v1",
};

// ── NemoClaw Audit Actions ───────────────────────────────────────────────────

export const NEMOCLAW_AUDIT_ACTIONS = {
  NEMOCLAW_REQUEST: "nvidia.nemoclaw.request",
  NEMOCLAW_ERROR: "nvidia.nemoclaw.error",
  NEMOCLAW_SANDBOX_INIT: "nvidia.nemoclaw.sandbox_init",
  NEMOCLAW_SANDBOX_POLICY: "nvidia.nemoclaw.sandbox_policy",
  NEMOCLAW_EGRESS_BLOCKED: "nvidia.nemoclaw.egress_blocked",
  NEMOCLAW_HEALTH_CHECK: "nvidia.nemoclaw.health_check",
  NEMOCLAW_PRIVACY_ROUTE: "nvidia.nemoclaw.privacy_route",
} as const;

// ── Types (internal) ─────────────────────────────────────────────────────────

type FetchFn = typeof globalThis.fetch;

export type NemoClawProviderDeps = {
  /** Custom fetch implementation — defaults to globalThis.fetch. */
  fetch?: FetchFn;
};

// ── Provider implementation ──────────────────────────────────────────────────

let globalHandle: NemoClawProviderHandle | null = null;

export function getNemoClawProvider(): NemoClawProviderHandle | null {
  return globalHandle;
}

export async function initNemoClawProvider(
  cfg: OpenClawConfig,
  deps: NemoClawProviderDeps = {},
): Promise<NemoClawProviderHandle> {
  const fetchFn: FetchFn = deps.fetch ?? globalThis.fetch;
  const ncCfg = cfg.enterprise?.nvidia?.nemoClaw;

  if (!ncCfg?.enabled) {
    const noop = createNoopHandle();
    globalHandle = noop;
    return noop;
  }

  const profile = ncCfg.inferenceProfile ?? "nvidia-cloud";
  const endpoint = resolveEndpoint(ncCfg, profile);
  let apiKey = "";

  if (ncCfg.apiKey) {
    apiKey = await resolveSecretValue(ncCfg.apiKey);
  }

  const models = NEMOCLAW_DEFAULT_MODELS.map((m) => toNemoClawModel(m, profile));
  const defaultModel = ncCfg.defaultModel ?? models[0]?.id ?? "";

  const retryCfg = {
    maxRetries: ncCfg.retry?.maxRetries ?? 3,
    backoffMs: ncCfg.retry?.backoffMs ?? 1000,
    maxBackoffMs: ncCfg.retry?.maxBackoffMs ?? 30000,
  };

  let sandboxStatus: NemoClawSandboxStatus = {
    running: false,
    profile,
    policyLoaded: false,
    egressBlocked: 0,
    egressAllowed: 0,
  };

  let healthStatus: NemoClawHealthStatus = {
    healthy: false,
    endpoint,
    sandboxStatus,
    lastCheckMs: 0,
  };

  let healthTimer: ReturnType<typeof setInterval> | null = null;

  // Sandbox status.
  //
  // IMPORTANT: this provider does NOT run a real NVIDIA OpenShell sandbox. There
  // is no process isolation, egress filtering, seccomp, or filesystem
  // confinement here — inference is a direct fetch() to the configured
  // endpoint. So we must never attest a sandbox that does not exist.
  //
  // Fail closed: if the operator configured a declarative security policy
  // (sandbox.policy) they are relying on enforcement we cannot provide. Refuse
  // to start rather than emit a false compliance signal. An operator who wants
  // to run without enforcement must not set a policy (or must disable the
  // sandbox block entirely).
  if (ncCfg.sandbox?.enabled !== false && ncCfg.sandbox?.policy) {
    throw new Error(
      "NemoClaw sandbox.policy is configured but no OpenShell enforcement backend is available; " +
        "refusing to start to avoid falsely attesting egress/seccomp/filesystem confinement. " +
        "Remove enterprise.nvidia.nemoClaw.sandbox.policy or set sandbox.enabled:false to run unsandboxed.",
    );
  }

  if (ncCfg.sandbox?.enabled !== false) {
    // Sandbox requested but unenforced: record the honest state (no policy is
    // ever loaded, nothing is running) and emit a non-success audit event so
    // the compliance trail does not claim a control that is absent.
    sandboxStatus = {
      running: false,
      profile,
      policyLoaded: false,
      egressBlocked: 0,
      egressAllowed: 0,
    };

    auditLogSync({
      action: NEMOCLAW_AUDIT_ACTIONS.NEMOCLAW_SANDBOX_INIT,
      category: "system",
      actor: { type: "system", id: "nemoclaw-provider" },
      outcome: "failure",
      metadata: {
        profile,
        sandboxEnabled: true,
        policyLoaded: false,
        enforced: false,
        note: "OpenShell sandbox enforcement is not available; no egress/seccomp/filesystem confinement is applied",
      },
    });
  }

  // Health check implementation
  async function checkHealth(): Promise<void> {
    const start = Date.now();
    try {
      const healthEndpoint = ncCfg?.healthCheck?.endpoint ?? "/v1/models";
      const url = healthEndpoint.startsWith("/")
        ? `${endpoint.replace(/\/v1$/, "")}${healthEndpoint}`
        : healthEndpoint;

      const headers: Record<string, string> = {
        Accept: "application/json",
      };
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const res = await fetchWithTimeout(fetchFn, url, { headers }, 10000);
      const elapsed = Date.now() - start;

      if (res.ok) {
        healthStatus = {
          healthy: true,
          endpoint,
          sandboxStatus,
          lastCheckMs: elapsed,
        };
        metrics.nemoClawHealthStatus.set({ endpoint }, 1);
      } else {
        healthStatus = {
          healthy: false,
          endpoint,
          sandboxStatus,
          lastCheckMs: elapsed,
          error: `HTTP ${res.status}`,
        };
        metrics.nemoClawHealthStatus.set({ endpoint }, 0);
      }
    } catch (err) {
      const elapsed = Date.now() - start;
      healthStatus = {
        healthy: false,
        endpoint,
        sandboxStatus,
        lastCheckMs: elapsed,
        error: (err as Error).message,
      };
      metrics.nemoClawHealthStatus.set({ endpoint }, 0);
    }
  }

  // Initial health check
  if (ncCfg.healthCheck?.enabled !== false) {
    await checkHealth().catch(() => {});
  }

  // Periodic health check
  if (ncCfg.healthCheck?.enabled !== false) {
    const interval = ncCfg.healthCheck?.intervalMs ?? 30000;
    healthTimer = setInterval(() => {
      checkHealth().catch(() => {});
    }, interval);
    if (healthTimer.unref) {
      healthTimer.unref();
    }
  }

  // Chat completion with retry
  async function chatCompletion(opts: NemoClawRequestOptions): Promise<NemoClawResponse> {
    const model = opts.model ?? defaultModel;
    const start = Date.now();

    const body: Record<string, unknown> = {
      model,
      messages: opts.messages,
    };
    if (opts.maxTokens !== undefined) {
      body.max_tokens = opts.maxTokens;
    }
    if (opts.temperature !== undefined) {
      body.temperature = opts.temperature;
    }
    if (opts.tools?.length) {
      body.tools = opts.tools;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retryCfg.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = Math.min(retryCfg.backoffMs * 2 ** (attempt - 1), retryCfg.maxBackoffMs);
        await sleep(delay);
      }

      try {
        const res = await fetchWithTimeout(
          fetchFn,
          `${endpoint}/chat/completions`,
          { method: "POST", headers, body: JSON.stringify(body) },
          120000,
        );

        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          lastError = new Error(`NemoClaw API error: HTTP ${res.status} - ${errBody}`);

          // NOTE: an upstream HTTP 403 from the inference endpoint is NOT a local
          // egress control — it is the remote server's own authorization result.
          // We deliberately do not emit NEMOCLAW_EGRESS_BLOCKED here, because
          // this provider performs no egress filtering and attributing a 403 to
          // a sandbox egress policy would be a false security attestation.

          if (res.status >= 400 && res.status < 500 && res.status !== 429) {
            break; // Don't retry client errors except rate limits
          }
          continue;
        }

        sandboxStatus.egressAllowed++;
        const data = (await res.json()) as NemoClawResponse;
        const elapsed = Date.now() - start;

        // Emit metrics
        metrics.nemoClawRequests.inc({ model, status: "success", profile });
        metrics.nemoClawLatency.observe({ model }, elapsed / 1000);
        if (data.usage) {
          metrics.nemoClawTokens.inc({ model, direction: "input" }, data.usage.prompt_tokens);
          metrics.nemoClawTokens.inc({ model, direction: "output" }, data.usage.completion_tokens);
        }

        // Emit audit event
        auditLogSync({
          action: NEMOCLAW_AUDIT_ACTIONS.NEMOCLAW_REQUEST,
          category: "system",
          actor: { type: "system", id: "nemoclaw-provider" },
          outcome: "success",
          durationMs: elapsed,
          metadata: {
            model,
            profile,
            promptTokens: data.usage?.prompt_tokens,
            completionTokens: data.usage?.completion_tokens,
            totalTokens: data.usage?.total_tokens,
          },
        });

        return data;
      } catch (err) {
        lastError = err as Error;
      }
    }

    // All retries exhausted
    metrics.nemoClawRequests.inc({ model, status: "error", profile });
    const elapsed = Date.now() - start;

    auditLogSync({
      action: NEMOCLAW_AUDIT_ACTIONS.NEMOCLAW_ERROR,
      category: "system",
      actor: { type: "system", id: "nemoclaw-provider" },
      outcome: "failure",
      durationMs: elapsed,
      errorMessage: lastError?.message,
      metadata: { model, profile, errorType: lastError?.constructor.name ?? "Unknown" },
    });

    throw lastError ?? new Error("NemoClaw request failed after retries");
  }

  const handle: NemoClawProviderHandle = {
    chatCompletion,
    getModels: () => [...models],
    getModel: (id) => models.find((m) => m.id === id) ?? null,
    getHealthStatus: () => ({ ...healthStatus }),
    getSandboxStatus: () => ({ ...sandboxStatus }),
    isHealthy: () => healthStatus.healthy,
    shutdown: async () => {
      if (healthTimer) {
        clearInterval(healthTimer);
        healthTimer = null;
      }
      globalHandle = null;
    },
  };

  globalHandle = handle;
  return handle;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveEndpoint(
  _cfg: EnterpriseNemoClawConfig,
  profile: NemoClawInferenceProfile,
): string {
  // Inference always goes directly to the profile endpoint. There is no
  // OpenShell gateway indirection in this provider, so the endpoint is the same
  // whether or not a sandbox is requested (see the sandbox note in
  // initNemoClawProvider). Do not claim routing that does not happen.
  return INFERENCE_ENDPOINTS[profile];
}

function toNemoClawModel(cfg: NimModelConfig, profile: NemoClawInferenceProfile): NemoClawModel {
  return {
    id: cfg.id,
    displayName: cfg.displayName ?? cfg.id,
    contextWindow: cfg.contextWindow ?? 131072,
    maxOutputTokens: cfg.maxOutputTokens ?? 32768,
    inferenceProfile: profile,
  };
}

function createNoopHandle(): NemoClawProviderHandle {
  const noopSandbox: NemoClawSandboxStatus = {
    running: false,
    profile: "nvidia-cloud",
    policyLoaded: false,
    egressBlocked: 0,
    egressAllowed: 0,
  };
  return {
    chatCompletion: async () => {
      throw new Error("NemoClaw provider is not enabled");
    },
    getModels: () => [],
    getModel: () => null,
    getHealthStatus: () => ({
      healthy: false,
      endpoint: "",
      sandboxStatus: noopSandbox,
      lastCheckMs: 0,
      error: "NemoClaw provider is not enabled",
    }),
    getSandboxStatus: () => noopSandbox,
    isHealthy: () => false,
    shutdown: async () => {},
  };
}

async function fetchWithTimeout(
  fn: FetchFn,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
