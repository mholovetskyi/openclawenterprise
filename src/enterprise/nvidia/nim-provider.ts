/**
 * NVIDIA NIM Model Provider — first-class NIM inference integration.
 *
 * NIM exposes OpenAI-compatible /v1/chat/completions endpoints.
 * Supports both NVIDIA-hosted (integrate.api.nvidia.com) and self-hosted NIM containers.
 *
 * Activation: enterprise.nvidia.nim.enabled: true
 */

import type { OpenClawConfig } from "../../config/config.js";
import type { NimModelConfig, NimModelCapability } from "../../config/types.enterprise.js";
import { auditLogSync } from "../audit/logger.js";
import { metrics } from "../monitoring/metrics.js";
import { resolveSecretValue } from "../secrets/index.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type NimModel = {
  id: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: NimModelCapability[];
  thinkingBudget: "configurable" | "none";
};

export type NimRequestOptions = {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens?: number;
  temperature?: number;
  thinkingBudgetTokens?: number;
  tools?: unknown[];
};

export type NimResponse = {
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

export type NimHealthStatus = {
  healthy: boolean;
  endpoint: string;
  availableModels: string[];
  lastCheckMs: number;
  error?: string;
};

export type NimProviderHandle = {
  chatCompletion(opts: NimRequestOptions): Promise<NimResponse>;
  getModels(): NimModel[];
  getModel(id: string): NimModel | null;
  getHealthStatus(): NimHealthStatus;
  isHealthy(): boolean;
  shutdown(): Promise<void>;
};

// ── Default models ───────────────────────────────────────────────────────────

const DEFAULT_MODELS: NimModelConfig[] = [
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
  {
    id: "nvidia/llama-3.1-nemotron-nano-8b-v1",
    displayName: "Nemotron Nano 8B",
    contextWindow: 131072,
    maxOutputTokens: 32768,
    capabilities: ["chat", "tool-calling"],
  },
];

const DEFAULT_ENDPOINT = "https://integrate.api.nvidia.com/v1";

// ── NIM Audit Actions ────────────────────────────────────────────────────────

export const NIM_AUDIT_ACTIONS = {
  NIM_REQUEST: "nvidia.nim.request",
  NIM_ERROR: "nvidia.nim.error",
  NIM_FALLBACK: "nvidia.nim.fallback",
  NIM_HEALTH_CHECK: "nvidia.nim.health_check",
} as const;

// ── Types (internal) ─────────────────────────────────────────────────────────

type FetchFn = typeof globalThis.fetch;

export type NimProviderDeps = {
  /** Custom fetch implementation — defaults to globalThis.fetch. */
  fetch?: FetchFn;
};

// ── Provider implementation ──────────────────────────────────────────────────

let globalHandle: NimProviderHandle | null = null;

export function getNimProvider(): NimProviderHandle | null {
  return globalHandle;
}

export async function initNimProvider(
  cfg: OpenClawConfig,
  deps: NimProviderDeps = {},
): Promise<NimProviderHandle> {
  const fetchFn: FetchFn = deps.fetch ?? globalThis.fetch;
  const nimCfg = cfg.enterprise?.nvidia?.nim;

  if (!nimCfg?.enabled) {
    const noop = createNoopHandle();
    globalHandle = noop;
    return noop;
  }

  const endpoint = (nimCfg.endpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, "");
  let apiKey = "";

  if (nimCfg.apiKey) {
    apiKey = await resolveSecretValue(nimCfg.apiKey);
  }

  const modelConfigs = nimCfg.models?.length ? nimCfg.models : DEFAULT_MODELS;
  const models = modelConfigs.map(toNimModel);
  const defaultModel = nimCfg.defaultModel ?? models[0]?.id ?? "";

  const retryCfg = {
    maxRetries: nimCfg.retry?.maxRetries ?? 3,
    backoffMs: nimCfg.retry?.backoffMs ?? 1000,
    maxBackoffMs: nimCfg.retry?.maxBackoffMs ?? 30000,
  };

  let healthStatus: NimHealthStatus = {
    healthy: false,
    endpoint,
    availableModels: [],
    lastCheckMs: 0,
  };

  let healthTimer: ReturnType<typeof setInterval> | null = null;

  // Health check implementation
  async function checkHealth(): Promise<void> {
    const start = Date.now();
    try {
      const healthEndpoint = nimCfg?.healthCheck?.endpoint ?? "/v1/models";
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
        // SAFETY: reached only under res.ok, so the body is the NIM /models listing (OpenAI-compatible) whose `data` array carries objects with string `id`; `data` is read optionally (?.), so a missing field degrades to [].
        const body = (await res.json()) as { data?: Array<{ id: string }> };
        const availableModels = body.data?.map((m) => m.id) ?? [];
        healthStatus = {
          healthy: true,
          endpoint,
          availableModels,
          lastCheckMs: elapsed,
        };
        metrics.nimHealthStatus.set({ endpoint }, 1);
      } else {
        healthStatus = {
          healthy: false,
          endpoint,
          availableModels: [],
          lastCheckMs: elapsed,
          error: `HTTP ${res.status}`,
        };
        metrics.nimHealthStatus.set({ endpoint }, 0);
      }
    } catch (err) {
      const elapsed = Date.now() - start;
      healthStatus = {
        healthy: false,
        endpoint,
        availableModels: [],
        lastCheckMs: elapsed,
        error: err instanceof Error ? err.message : String(err),
      };
      metrics.nimHealthStatus.set({ endpoint }, 0);
    }
  }

  // Initial health check (only when health checks are enabled)
  if (nimCfg.healthCheck?.enabled !== false) {
    await checkHealth().catch(() => {});
  }

  // Periodic health check
  if (nimCfg.healthCheck?.enabled !== false) {
    const interval = nimCfg.healthCheck?.intervalMs ?? 30000;
    healthTimer = setInterval(() => {
      checkHealth().catch(() => {});
    }, interval);
    if (healthTimer.unref) {
      healthTimer.unref();
    }
  }

  // Chat completion with retry + fallback
  async function chatCompletion(opts: NimRequestOptions): Promise<NimResponse> {
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

    // Thinking budget for Nemotron 3 Nano
    if (opts.thinkingBudgetTokens !== undefined) {
      body.thinking = { budget_tokens: opts.thinkingBudgetTokens };
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
          lastError = new Error(`NIM API error: HTTP ${res.status} - ${errBody}`);
          if (res.status >= 400 && res.status < 500 && res.status !== 429) {
            break; // Don't retry client errors except rate limits
          }
          continue;
        }

        // SAFETY: reached only after the non-ok branch returned/continued above, so the body is a success response from the NIM (OpenAI-compatible) chat/completions endpoint, matching NimResponse; optional fields (usage) are read with ?.
        const data = (await res.json()) as NimResponse;
        const elapsed = Date.now() - start;

        // Emit metrics
        metrics.nimRequests.inc({ model, status: "success" });
        metrics.nimLatency.observe({ model }, elapsed / 1000);
        if (data.usage) {
          metrics.nimTokens.inc({ model, direction: "input" }, data.usage.prompt_tokens);
          metrics.nimTokens.inc({ model, direction: "output" }, data.usage.completion_tokens);
        }

        // Emit audit event
        auditLogSync({
          action: NIM_AUDIT_ACTIONS.NIM_REQUEST,
          category: "system",
          actor: { type: "system", id: "nim-provider" },
          outcome: "success",
          durationMs: elapsed,
          metadata: {
            model,
            promptTokens: data.usage?.prompt_tokens,
            completionTokens: data.usage?.completion_tokens,
            totalTokens: data.usage?.total_tokens,
          },
        });

        return data;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    // All retries exhausted — emit error metrics and audit
    metrics.nimRequests.inc({ model, status: "error" });
    const elapsed = Date.now() - start;

    auditLogSync({
      action: NIM_AUDIT_ACTIONS.NIM_ERROR,
      category: "system",
      actor: { type: "system", id: "nim-provider" },
      outcome: "failure",
      durationMs: elapsed,
      errorMessage: lastError?.message,
      metadata: { model, errorType: lastError?.constructor.name ?? "Unknown" },
    });

    // Fallback
    if (nimCfg?.fallbackModel) {
      auditLogSync({
        action: NIM_AUDIT_ACTIONS.NIM_FALLBACK,
        category: "system",
        actor: { type: "system", id: "nim-provider" },
        outcome: "success",
        metadata: { originalModel: model, fallbackModel: nimCfg.fallbackModel },
      });
    }

    throw lastError ?? new Error("NIM request failed after retries");
  }

  const handle: NimProviderHandle = {
    chatCompletion,
    getModels: () => [...models],
    getModel: (id) => models.find((m) => m.id === id) ?? null,
    getHealthStatus: () => ({ ...healthStatus }),
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

function toNimModel(cfg: NimModelConfig): NimModel {
  return {
    id: cfg.id,
    displayName: cfg.displayName ?? cfg.id,
    contextWindow: cfg.contextWindow ?? 131072,
    maxOutputTokens: cfg.maxOutputTokens ?? 32768,
    capabilities: cfg.capabilities ?? ["chat"],
    thinkingBudget: cfg.thinkingBudget ?? "none",
  };
}

function createNoopHandle(): NimProviderHandle {
  return {
    chatCompletion: async () => {
      throw new Error("NIM provider is not enabled");
    },
    getModels: () => [],
    getModel: () => null,
    getHealthStatus: () => ({
      healthy: false,
      endpoint: "",
      availableModels: [],
      lastCheckMs: 0,
      error: "NIM provider is not enabled",
    }),
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
