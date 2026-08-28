import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import {
  initNimProvider,
  getNimProvider,
  NIM_AUDIT_ACTIONS,
  type NimProviderHandle,
} from "./nim-provider.js";

// Mock metrics to avoid real Prometheus registry
vi.mock("../monitoring/metrics.js", () => {
  const noopCounter = { inc: vi.fn() };
  const noopGauge = { set: vi.fn(), inc: vi.fn(), dec: vi.fn() };
  const noopHistogram = { observe: vi.fn(), startTimer: vi.fn(() => vi.fn()) };
  return {
    metrics: {
      nimRequests: noopCounter,
      nimLatency: noopHistogram,
      nimTokens: noopCounter,
      nimHealthStatus: noopGauge,
      gpuUtilization: noopGauge,
      gpuMemoryUsed: noopGauge,
      gpuMemoryTotal: noopGauge,
      gpuTemperature: noopGauge,
      gpuPowerDraw: noopGauge,
      gpuPowerLimit: noopGauge,
    },
    rebuildMetrics: vi.fn(),
  };
});

// Mock secrets module
vi.mock("../secrets/index.js", () => ({
  resolveSecretValue: vi.fn(async (val: string) => {
    if (val === "env://NIM_API_KEY") return "test-api-key-123";
    return val;
  }),
}));

// Mock audit logger
const mockAuditLog = vi.fn(async (..._args: unknown[]) => null);
const mockAuditLogSync = vi.fn();
vi.mock("../audit/logger.js", () => ({
  auditLog: (...args: unknown[]) => mockAuditLog(...args),
  auditLogSync: (...args: unknown[]) => mockAuditLogSync(...args),
}));

// Mock fetch passed via DI
const mockFetch = vi.fn() as unknown as ReturnType<typeof vi.fn> & typeof globalThis.fetch;
const deps = { fetch: mockFetch as unknown as typeof globalThis.fetch };

function makeCfg(nimOverrides: Record<string, unknown> = {}): OpenClawConfig {
  return {
    enterprise: {
      enabled: true,
      nvidia: {
        nim: {
          enabled: true,
          endpoint: "https://nim.test.local/v1",
          apiKey: "env://NIM_API_KEY",
          defaultModel: "nvidia/nemotron-3-nano-30b-a3b",
          healthCheck: { enabled: false },
          retry: { maxRetries: 1, backoffMs: 10, maxBackoffMs: 100 },
          ...nimOverrides,
        },
      },
    },
  } as unknown as OpenClawConfig;
}

function mockFetchResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
    redirected: false,
    statusText: "OK",
    type: "basic" as ResponseType,
    url: "",
    clone: () => mockFetchResponse(status, body),
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
    bytes: async () => new Uint8Array(),
  } as Response;
}

describe("NIM Provider - initialization", () => {
  let handle: NimProviderHandle;

  afterEach(async () => {
    if (handle) await handle.shutdown();
  });

  it("creates noop handle when NIM is disabled", async () => {
    handle = await initNimProvider({
      enterprise: { nvidia: { nim: { enabled: false } } },
    } as unknown as OpenClawConfig);
    expect(handle.getModels()).toHaveLength(0);
    expect(handle.isHealthy()).toBe(false);
    await expect(
      handle.chatCompletion({
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow("NIM provider is not enabled");
  });

  it("creates noop handle when enterprise.nvidia is undefined", async () => {
    handle = await initNimProvider({} as OpenClawConfig);
    expect(handle.getModels()).toHaveLength(0);
    expect(handle.isHealthy()).toBe(false);
  });

  it("resolves API key through secret manager", async () => {
    const { resolveSecretValue } = await import("../secrets/index.js");
    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, { data: [] }));
    handle = await initNimProvider(makeCfg(), deps);
    expect(resolveSecretValue).toHaveBeenCalledWith("env://NIM_API_KEY");
  });

  it("registers default models when none are configured", async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, { data: [] }));
    handle = await initNimProvider(makeCfg({ models: undefined }), deps);
    const models = handle.getModels();
    expect(models.length).toBeGreaterThanOrEqual(3);
    expect(models.some((m) => m.id === "nvidia/nemotron-3-nano-30b-a3b")).toBe(true);
    expect(models.some((m) => m.id === "nvidia/llama-3.3-nemotron-super-49b-v1")).toBe(true);
    expect(models.some((m) => m.id === "nvidia/llama-3.1-nemotron-nano-8b-v1")).toBe(true);
  });

  it("registers custom models from config", async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, { data: [] }));
    handle = await initNimProvider(
      makeCfg({
        models: [
          {
            id: "custom/model-1",
            displayName: "Custom Model",
            contextWindow: 8192,
            maxOutputTokens: 4096,
            capabilities: ["chat"],
          },
        ],
      }),
      deps,
    );
    const models = handle.getModels();
    expect(models).toHaveLength(1);
    expect(models[0]!.id).toBe("custom/model-1");
    expect(models[0]!.displayName).toBe("Custom Model");
  });

  it("getModel returns null for unknown model ID", async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, { data: [] }));
    handle = await initNimProvider(makeCfg(), deps);
    expect(handle.getModel("nonexistent/model")).toBeNull();
  });

  it("getModel returns model for valid ID", async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, { data: [] }));
    handle = await initNimProvider(makeCfg(), deps);
    const model = handle.getModel("nvidia/nemotron-3-nano-30b-a3b");
    expect(model).not.toBeNull();
    expect(model?.thinkingBudget).toBe("configurable");
  });
});

describe("NIM Provider - health check", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(async () => {
    const p = getNimProvider();
    if (p) await p.shutdown();
  });

  it("reports healthy when /v1/models returns 200", async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(200, {
        data: [
          { id: "nvidia/nemotron-3-nano-30b-a3b" },
          { id: "nvidia/llama-3.1-nemotron-nano-8b-v1" },
        ],
      }),
    );

    const handle = await initNimProvider(
      makeCfg({ healthCheck: { enabled: true, intervalMs: 999999 } }),
      deps,
    );
    const status = handle.getHealthStatus();
    expect(status.healthy).toBe(true);
    expect(status.availableModels).toContain("nvidia/nemotron-3-nano-30b-a3b");
    await handle.shutdown();
  });

  it("reports unhealthy when /v1/models returns error", async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(500, { error: "internal" }));

    const handle = await initNimProvider(
      makeCfg({ healthCheck: { enabled: true, intervalMs: 999999 } }),
      deps,
    );
    const status = handle.getHealthStatus();
    expect(status.healthy).toBe(false);
    expect(status.error).toContain("HTTP 500");
    await handle.shutdown();
  });

  it("reports unhealthy when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    const handle = await initNimProvider(
      makeCfg({ healthCheck: { enabled: true, intervalMs: 999999 } }),
      deps,
    );
    const status = handle.getHealthStatus();
    expect(status.healthy).toBe(false);
    expect(status.error).toContain("Connection refused");
    await handle.shutdown();
  });
});

describe("NIM Provider - chatCompletion", () => {
  let handle: NimProviderHandle;

  beforeEach(async () => {
    mockFetch.mockReset();
    mockAuditLogSync.mockClear();
    // Health check mock
    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, { data: [] }));
  });

  afterEach(async () => {
    if (handle) await handle.shutdown();
  });

  it("sends chat completion request and returns response", async () => {
    handle = await initNimProvider(
      makeCfg({ healthCheck: { enabled: true, intervalMs: 999999 } }),
      deps,
    );

    const mockResponse = {
      id: "chat-123",
      model: "nvidia/nemotron-3-nano-30b-a3b",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hello!" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, mockResponse));

    const result = await handle.chatCompletion({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result.id).toBe("chat-123");
    expect(result.choices[0]!.message.content).toBe("Hello!");
    expect(result.usage.total_tokens).toBe(15);
  });

  it("includes thinking budget in request body for Nemotron 3 Nano", async () => {
    handle = await initNimProvider(
      makeCfg({ healthCheck: { enabled: true, intervalMs: 999999 } }),
      deps,
    );

    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(200, {
        id: "chat-124",
        model: "nvidia/nemotron-3-nano-30b-a3b",
        choices: [
          { index: 0, message: { role: "assistant", content: "thought" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 50, total_tokens: 60 },
      }),
    );

    await handle.chatCompletion({
      messages: [{ role: "user", content: "Think about this" }],
      thinkingBudgetTokens: 2048,
    });

    const callArgs = mockFetch.mock.calls[1]!; // [1] because [0] is health check
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.thinking).toEqual({ budget_tokens: 2048 });
  });

  it("emits audit event on successful request", async () => {
    handle = await initNimProvider(
      makeCfg({ healthCheck: { enabled: true, intervalMs: 999999 } }),
      deps,
    );

    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(200, {
        id: "chat-125",
        model: "nvidia/nemotron-3-nano-30b-a3b",
        choices: [
          { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
      }),
    );

    await handle.chatCompletion({ messages: [{ role: "user", content: "test" }] });

    expect(mockAuditLogSync).toHaveBeenCalledWith(
      expect.objectContaining({
        action: NIM_AUDIT_ACTIONS.NIM_REQUEST,
        outcome: "success",
      }),
    );
  });

  it("retries on 500 then succeeds", async () => {
    handle = await initNimProvider(
      makeCfg({ healthCheck: { enabled: true, intervalMs: 999999 } }),
      deps,
    );

    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(500, { error: "temporary" }))
      .mockResolvedValueOnce(
        mockFetchResponse(200, {
          id: "chat-retry",
          model: "nvidia/nemotron-3-nano-30b-a3b",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "retry ok" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        }),
      );

    const result = await handle.chatCompletion({
      messages: [{ role: "user", content: "test" }],
    });

    expect(result.choices[0]!.message.content).toBe("retry ok");
  });

  it("does not retry on 400 client error", async () => {
    handle = await initNimProvider(
      makeCfg({ healthCheck: { enabled: true, intervalMs: 999999 } }),
      deps,
    );

    mockFetch.mockResolvedValueOnce(mockFetchResponse(400, { error: "bad request" }));

    await expect(
      handle.chatCompletion({
        messages: [{ role: "user", content: "test" }],
      }),
    ).rejects.toThrow("NIM API error: HTTP 400");
  });

  it("retries on 429 rate limit", async () => {
    handle = await initNimProvider(
      makeCfg({ healthCheck: { enabled: true, intervalMs: 999999 } }),
      deps,
    );

    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(429, { error: "rate limited" }))
      .mockResolvedValueOnce(
        mockFetchResponse(200, {
          id: "chat-429",
          model: "nvidia/nemotron-3-nano-30b-a3b",
          choices: [
            { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
        }),
      );

    const result = await handle.chatCompletion({
      messages: [{ role: "user", content: "test" }],
    });
    expect(result.choices[0]!.message.content).toBe("ok");
  });

  it("emits error audit and fallback audit when all retries fail", async () => {
    handle = await initNimProvider(
      makeCfg({
        healthCheck: { enabled: true, intervalMs: 999999 },
        fallbackModel: "openai/gpt-4",
      }),
      deps,
    );

    mockFetch
      .mockRejectedValueOnce(new Error("network down"))
      .mockRejectedValueOnce(new Error("network down"));

    await expect(
      handle.chatCompletion({
        messages: [{ role: "user", content: "test" }],
      }),
    ).rejects.toThrow("network down");

    // Should have emitted error audit
    expect(mockAuditLogSync).toHaveBeenCalledWith(
      expect.objectContaining({
        action: NIM_AUDIT_ACTIONS.NIM_ERROR,
        outcome: "failure",
      }),
    );

    // Should have emitted fallback audit
    expect(mockAuditLogSync).toHaveBeenCalledWith(
      expect.objectContaining({
        action: NIM_AUDIT_ACTIONS.NIM_FALLBACK,
        metadata: expect.objectContaining({
          fallbackModel: "openai/gpt-4",
        }),
      }),
    );
  });
});

describe("NIM Provider - metrics emission", () => {
  let handle: NimProviderHandle;

  afterEach(async () => {
    if (handle) await handle.shutdown();
  });

  it("increments nimRequests counter on success", async () => {
    const { metrics } = await import("../monitoring/metrics.js");
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, { data: [] }));
    handle = await initNimProvider(
      makeCfg({ healthCheck: { enabled: true, intervalMs: 999999 } }),
      deps,
    );

    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(200, {
        id: "m1",
        model: "nvidia/nemotron-3-nano-30b-a3b",
        choices: [
          { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );

    await handle.chatCompletion({ messages: [{ role: "user", content: "hi" }] });
    expect(metrics.nimRequests.inc).toHaveBeenCalledWith(
      expect.objectContaining({ model: "nvidia/nemotron-3-nano-30b-a3b", status: "success" }),
    );
  });
});

describe("NIM Provider - shutdown", () => {
  it("clears global handle and interval on shutdown", async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, { data: [] }));
    const handle = await initNimProvider(
      makeCfg({ healthCheck: { enabled: true, intervalMs: 999999 } }),
      deps,
    );
    expect(getNimProvider()).not.toBeNull();
    await handle.shutdown();
    expect(getNimProvider()).toBeNull();
  });
});

describe("NIM Audit Actions", () => {
  it("follows naming convention", () => {
    expect(NIM_AUDIT_ACTIONS.NIM_REQUEST).toBe("nvidia.nim.request");
    expect(NIM_AUDIT_ACTIONS.NIM_ERROR).toBe("nvidia.nim.error");
    expect(NIM_AUDIT_ACTIONS.NIM_FALLBACK).toBe("nvidia.nim.fallback");
  });
});
