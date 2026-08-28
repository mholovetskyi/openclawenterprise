import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import {
  initNemoClawProvider,
  getNemoClawProvider,
  NEMOCLAW_AUDIT_ACTIONS,
  type NemoClawProviderHandle,
} from "./nemoclaw-provider.js";

// Mock metrics to avoid real Prometheus registry
vi.mock("../monitoring/metrics.js", () => {
  const noopCounter = { inc: vi.fn() };
  const noopGauge = { set: vi.fn(), inc: vi.fn(), dec: vi.fn() };
  const noopHistogram = { observe: vi.fn(), startTimer: vi.fn(() => vi.fn()) };
  return {
    metrics: {
      nemoClawRequests: noopCounter,
      nemoClawLatency: noopHistogram,
      nemoClawTokens: noopCounter,
      nemoClawHealthStatus: noopGauge,
      nemoClawSandboxEgress: noopCounter,
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
    if (val === "env://NEMOCLAW_API_KEY") {
      return "test-nemoclaw-key-123";
    }
    return val;
  }),
}));

// Mock audit logger
const mockAuditLogSync = vi.fn();
vi.mock("../audit/logger.js", () => ({
  auditLog: vi.fn(async () => null),
  auditLogSync: (...args: unknown[]) => mockAuditLogSync(...args),
}));

// Mock fetch passed via DI
const mockFetch = vi.fn() as unknown as ReturnType<typeof vi.fn> & typeof globalThis.fetch;
const deps = { fetch: mockFetch as unknown as typeof globalThis.fetch };

function makeCfg(nemoClawOverrides: Record<string, unknown> = {}): OpenClawConfig {
  return {
    enterprise: {
      enabled: true,
      nvidia: {
        nemoClaw: {
          enabled: true,
          inferenceProfile: "nvidia-cloud",
          apiKey: "env://NEMOCLAW_API_KEY",
          defaultModel: "nvidia/nemotron-3-super-120b-a12b",
          sandbox: { enabled: true },
          healthCheck: { enabled: false },
          retry: { maxRetries: 1, backoffMs: 10, maxBackoffMs: 100 },
          ...nemoClawOverrides,
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

describe("NemoClaw Provider - initialization", () => {
  let handle: NemoClawProviderHandle;

  afterEach(async () => {
    if (handle) {
      await handle.shutdown();
    }
  });

  it("creates noop handle when NemoClaw is disabled", async () => {
    handle = await initNemoClawProvider({
      enterprise: { nvidia: { nemoClaw: { enabled: false } } },
    } as unknown as OpenClawConfig);
    expect(handle.getModels()).toHaveLength(0);
    expect(handle.isHealthy()).toBe(false);
    await expect(
      handle.chatCompletion({
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toThrow("NemoClaw provider is not enabled");
  });

  it("creates noop handle when enterprise.nvidia is undefined", async () => {
    handle = await initNemoClawProvider({} as OpenClawConfig);
    expect(handle.getModels()).toHaveLength(0);
    expect(handle.isHealthy()).toBe(false);
  });

  it("resolves API key through secret manager", async () => {
    const { resolveSecretValue } = await import("../secrets/index.js");
    handle = await initNemoClawProvider(makeCfg(), deps);
    expect(resolveSecretValue).toHaveBeenCalledWith("env://NEMOCLAW_API_KEY");
  });

  it("registers default NemoClaw models including Nemotron 3 Super 120B", async () => {
    handle = await initNemoClawProvider(makeCfg(), deps);
    const models = handle.getModels();
    expect(models.length).toBeGreaterThanOrEqual(3);
    expect(models.some((m) => m.id === "nvidia/nemotron-3-super-120b-a12b")).toBe(true);
    expect(models.some((m) => m.id === "nvidia/nemotron-3-nano-30b-a3b")).toBe(true);
    expect(models.some((m) => m.id === "nvidia/llama-3.3-nemotron-super-49b-v1")).toBe(true);
  });

  it("sets inference profile on models", async () => {
    handle = await initNemoClawProvider(makeCfg({ inferenceProfile: "local-nim" }), deps);
    const models = handle.getModels();
    expect(models[0]!.inferenceProfile).toBe("local-nim");
  });

  it("getModel returns null for unknown model ID", async () => {
    handle = await initNemoClawProvider(makeCfg(), deps);
    expect(handle.getModel("nonexistent/model")).toBeNull();
  });

  it("getModel returns model for valid ID", async () => {
    handle = await initNemoClawProvider(makeCfg(), deps);
    const model = handle.getModel("nvidia/nemotron-3-super-120b-a12b");
    expect(model).not.toBeNull();
    expect(model?.displayName).toBe("Nemotron 3 Super 120B");
  });
});

describe("NemoClaw Provider - sandbox", () => {
  let handle: NemoClawProviderHandle;

  afterEach(async () => {
    if (handle) {
      await handle.shutdown();
    }
  });

  it("initializes sandbox status when enabled", async () => {
    mockAuditLogSync.mockClear();
    handle = await initNemoClawProvider(makeCfg({ sandbox: { enabled: true } }), deps);
    const status = handle.getSandboxStatus();
    expect(status.running).toBe(true);
    expect(status.profile).toBe("nvidia-cloud");
    expect(mockAuditLogSync).toHaveBeenCalledWith(
      expect.objectContaining({
        action: NEMOCLAW_AUDIT_ACTIONS.NEMOCLAW_SANDBOX_INIT,
        outcome: "success",
      }),
    );
  });

  it("sandbox is not running when disabled", async () => {
    handle = await initNemoClawProvider(makeCfg({ sandbox: { enabled: false } }), deps);
    const status = handle.getSandboxStatus();
    expect(status.running).toBe(false);
  });
});

describe("NemoClaw Provider - health check", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(async () => {
    const p = getNemoClawProvider();
    if (p) {
      await p.shutdown();
    }
  });

  it("reports healthy when endpoint returns 200", async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(200, {
        data: [{ id: "nvidia/nemotron-3-super-120b-a12b" }],
      }),
    );

    const handle = await initNemoClawProvider(
      makeCfg({
        healthCheck: { enabled: true, intervalMs: 999999 },
      }),
      deps,
    );
    const status = handle.getHealthStatus();
    expect(status.healthy).toBe(true);
    await handle.shutdown();
  });

  it("reports unhealthy when endpoint returns error", async () => {
    mockFetch.mockResolvedValueOnce(mockFetchResponse(500, { error: "internal" }));

    const handle = await initNemoClawProvider(
      makeCfg({
        healthCheck: { enabled: true, intervalMs: 999999 },
      }),
      deps,
    );
    const status = handle.getHealthStatus();
    expect(status.healthy).toBe(false);
    expect(status.error).toContain("HTTP 500");
    await handle.shutdown();
  });

  it("reports unhealthy when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    const handle = await initNemoClawProvider(
      makeCfg({
        healthCheck: { enabled: true, intervalMs: 999999 },
      }),
      deps,
    );
    const status = handle.getHealthStatus();
    expect(status.healthy).toBe(false);
    expect(status.error).toContain("Connection refused");
    await handle.shutdown();
  });
});

describe("NemoClaw Provider - chatCompletion", () => {
  let handle: NemoClawProviderHandle;

  beforeEach(async () => {
    mockFetch.mockReset();
    mockAuditLogSync.mockClear();
  });

  afterEach(async () => {
    if (handle) {
      await handle.shutdown();
    }
  });

  it("sends chat completion request and returns response", async () => {
    handle = await initNemoClawProvider(makeCfg(), deps);

    const mockResponse = {
      id: "chat-nc-123",
      model: "nvidia/nemotron-3-super-120b-a12b",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hello from NemoClaw!" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, mockResponse));

    const result = await handle.chatCompletion({
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result.id).toBe("chat-nc-123");
    expect(result.choices[0]!.message.content).toBe("Hello from NemoClaw!");
    expect(result.usage.total_tokens).toBe(15);
  });

  it("emits audit event on successful request", async () => {
    handle = await initNemoClawProvider(makeCfg(), deps);

    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(200, {
        id: "chat-nc-125",
        model: "nvidia/nemotron-3-super-120b-a12b",
        choices: [
          { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
      }),
    );

    await handle.chatCompletion({ messages: [{ role: "user", content: "test" }] });

    expect(mockAuditLogSync).toHaveBeenCalledWith(
      expect.objectContaining({
        action: NEMOCLAW_AUDIT_ACTIONS.NEMOCLAW_REQUEST,
        outcome: "success",
        metadata: expect.objectContaining({
          profile: "nvidia-cloud",
        }),
      }),
    );
  });

  it("retries on 500 then succeeds", async () => {
    handle = await initNemoClawProvider(makeCfg(), deps);

    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(500, { error: "temporary" }))
      .mockResolvedValueOnce(
        mockFetchResponse(200, {
          id: "chat-nc-retry",
          model: "nvidia/nemotron-3-super-120b-a12b",
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
    handle = await initNemoClawProvider(makeCfg(), deps);

    mockFetch.mockResolvedValueOnce(mockFetchResponse(400, { error: "bad request" }));

    await expect(
      handle.chatCompletion({
        messages: [{ role: "user", content: "test" }],
      }),
    ).rejects.toThrow("NemoClaw API error: HTTP 400");
  });

  it("tracks egress blocked on 403", async () => {
    handle = await initNemoClawProvider(makeCfg(), deps);

    mockFetch.mockResolvedValueOnce(mockFetchResponse(403, { error: "forbidden" }));

    await expect(
      handle.chatCompletion({
        messages: [{ role: "user", content: "test" }],
      }),
    ).rejects.toThrow("NemoClaw API error: HTTP 403");

    expect(mockAuditLogSync).toHaveBeenCalledWith(
      expect.objectContaining({
        action: NEMOCLAW_AUDIT_ACTIONS.NEMOCLAW_EGRESS_BLOCKED,
        category: "security",
      }),
    );
  });

  it("emits error audit when all retries fail", async () => {
    handle = await initNemoClawProvider(makeCfg(), deps);

    mockFetch
      .mockRejectedValueOnce(new Error("network down"))
      .mockRejectedValueOnce(new Error("network down"));

    await expect(
      handle.chatCompletion({
        messages: [{ role: "user", content: "test" }],
      }),
    ).rejects.toThrow("network down");

    expect(mockAuditLogSync).toHaveBeenCalledWith(
      expect.objectContaining({
        action: NEMOCLAW_AUDIT_ACTIONS.NEMOCLAW_ERROR,
        outcome: "failure",
      }),
    );
  });
});

describe("NemoClaw Provider - metrics emission", () => {
  let handle: NemoClawProviderHandle;

  afterEach(async () => {
    if (handle) {
      await handle.shutdown();
    }
  });

  it("increments nemoClawRequests counter on success", async () => {
    const { metrics } = await import("../monitoring/metrics.js");
    mockFetch.mockReset();
    handle = await initNemoClawProvider(makeCfg(), deps);

    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(200, {
        id: "m1",
        model: "nvidia/nemotron-3-super-120b-a12b",
        choices: [
          { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );

    await handle.chatCompletion({ messages: [{ role: "user", content: "hi" }] });
    // eslint-disable-next-line typescript-eslint/unbound-method -- vitest mock
    expect(metrics.nemoClawRequests.inc).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "nvidia/nemotron-3-super-120b-a12b",
        status: "success",
        profile: "nvidia-cloud",
      }),
    );
  });
});

describe("NemoClaw Provider - shutdown", () => {
  it("clears global handle on shutdown", async () => {
    const handle = await initNemoClawProvider(makeCfg(), deps);
    expect(getNemoClawProvider()).not.toBeNull();
    await handle.shutdown();
    expect(getNemoClawProvider()).toBeNull();
  });
});

describe("NemoClaw Audit Actions", () => {
  it("follows naming convention", () => {
    expect(NEMOCLAW_AUDIT_ACTIONS.NEMOCLAW_REQUEST).toBe("nvidia.nemoclaw.request");
    expect(NEMOCLAW_AUDIT_ACTIONS.NEMOCLAW_ERROR).toBe("nvidia.nemoclaw.error");
    expect(NEMOCLAW_AUDIT_ACTIONS.NEMOCLAW_SANDBOX_INIT).toBe("nvidia.nemoclaw.sandbox_init");
    expect(NEMOCLAW_AUDIT_ACTIONS.NEMOCLAW_EGRESS_BLOCKED).toBe("nvidia.nemoclaw.egress_blocked");
    expect(NEMOCLAW_AUDIT_ACTIONS.NEMOCLAW_PRIVACY_ROUTE).toBe("nvidia.nemoclaw.privacy_route");
  });
});
