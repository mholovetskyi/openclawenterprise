import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import {
  initGpuMetrics,
  getGpuMetricsHandle,
  parseNvidiaSmiOutput,
  GPU_AUDIT_ACTIONS,
  type GpuMetricsHandle,
  type GpuMetricsDeps,
} from "./gpu-metrics.js";

// Mock metrics
vi.mock("../monitoring/metrics.js", () => {
  const makeGauge = () => ({ set: vi.fn(), inc: vi.fn(), dec: vi.fn() });
  return {
    metrics: {
      gpuUtilization: makeGauge(),
      gpuMemoryUsed: makeGauge(),
      gpuMemoryTotal: makeGauge(),
      gpuTemperature: makeGauge(),
      gpuPowerDraw: makeGauge(),
      gpuPowerLimit: makeGauge(),
      nimRequests: { inc: vi.fn() },
      nimLatency: { observe: vi.fn() },
      nimTokens: { inc: vi.fn() },
      nimHealthStatus: { set: vi.fn() },
    },
    rebuildMetrics: vi.fn(),
  };
});

// Mock audit logger
const mockAuditLogSync = vi.fn();
vi.mock("../audit/logger.js", () => ({
  auditLog: vi.fn(async () => null),
  auditLogSync: (...args: unknown[]) => mockAuditLogSync(...args),
}));

const SAMPLE_SMI_OUTPUT = `0, NVIDIA A100-SXM4-80GB, 45, 32, 81920, 26214, 55706, 52, 150.00, 400.00, 35, P0
1, NVIDIA A100-SXM4-80GB, 78, 65, 81920, 53248, 28672, 68, 280.00, 400.00, 50, P0`;

const SINGLE_GPU_OUTPUT = `0, NVIDIA H100, 92, 88, 81920, 72090, 9830, 75, 380.00, 700.00, 45, P0`;

function makeCfg(overrides: Record<string, unknown> = {}): OpenClawConfig {
  return {
    enterprise: {
      enabled: true,
      nvidia: {
        gpuMetrics: {
          enabled: true,
          pollIntervalMs: 999999,
          alertThresholds: {
            gpuUtilization: 95,
            memoryUtilization: 90,
            temperature: 85,
            powerDraw: 95,
          },
          ...overrides,
        },
      },
    },
  } as unknown as OpenClawConfig;
}

function makeSmiDeps(smiOutput: string): GpuMetricsDeps {
  let callCount = 0;
  return {
    exec: async () => {
      callCount++;
      if (callCount === 1) return { stdout: "NVIDIA-SMI 535.129.03", stderr: "" };
      return { stdout: smiOutput, stderr: "" };
    },
  };
}

describe("parseNvidiaSmiOutput", () => {
  it("parses single GPU output", () => {
    const states = parseNvidiaSmiOutput(SINGLE_GPU_OUTPUT);
    expect(states).toHaveLength(1);
    expect(states[0]!.index).toBe(0);
    expect(states[0]!.name).toBe("NVIDIA H100");
    expect(states[0]!.gpuUtilization).toBe(92);
    expect(states[0]!.memoryUtilization).toBe(88);
    expect(states[0]!.memoryTotal).toBe(81920);
    expect(states[0]!.memoryUsed).toBe(72090);
    expect(states[0]!.memoryFree).toBe(9830);
    expect(states[0]!.temperature).toBe(75);
    expect(states[0]!.powerDraw).toBe(380);
    expect(states[0]!.powerLimit).toBe(700);
    expect(states[0]!.fanSpeed).toBe(45);
    expect(states[0]!.pstate).toBe("P0");
  });

  it("parses multi-GPU output", () => {
    const states = parseNvidiaSmiOutput(SAMPLE_SMI_OUTPUT);
    expect(states).toHaveLength(2);
    expect(states[0]!.index).toBe(0);
    expect(states[1]!.index).toBe(1);
    expect(states[0]!.gpuUtilization).toBe(45);
    expect(states[1]!.gpuUtilization).toBe(78);
  });

  it("handles empty output", () => {
    const states = parseNvidiaSmiOutput("");
    expect(states).toHaveLength(0);
  });

  it("handles malformed lines (too few fields)", () => {
    const states = parseNvidiaSmiOutput("0, NVIDIA A100, 45, 32");
    expect(states).toHaveLength(0);
  });

  it("handles lines with N/A values", () => {
    const output = "0, NVIDIA A100, N/A, N/A, 81920, 0, 81920, 30, N/A, N/A, N/A, P8";
    const states = parseNvidiaSmiOutput(output);
    expect(states).toHaveLength(1);
    expect(states[0]!.gpuUtilization).toBe(0);
    expect(states[0]!.temperature).toBe(30);
  });

  it("handles whitespace-only output", () => {
    const states = parseNvidiaSmiOutput("   \n   \n   ");
    expect(states).toHaveLength(0);
  });
});

describe("GPU Metrics - initialization", () => {
  let handle: GpuMetricsHandle;

  beforeEach(() => {
    mockAuditLogSync.mockClear();
  });

  afterEach(async () => {
    if (handle) await handle.shutdown();
  });

  it("creates noop handle when gpuMetrics is disabled", async () => {
    handle = await initGpuMetrics({
      enterprise: { nvidia: { gpuMetrics: { enabled: false } } },
    } as unknown as OpenClawConfig);
    expect(handle.getGpuStates()).toHaveLength(0);
    expect(handle.isAvailable()).toBe(false);
  });

  it("creates noop handle when enterprise.nvidia is undefined", async () => {
    handle = await initGpuMetrics({} as OpenClawConfig);
    expect(handle.isAvailable()).toBe(false);
  });

  it("creates noop handle when nvidia-smi is not found", async () => {
    handle = await initGpuMetrics(makeCfg(), {
      exec: async () => {
        throw new Error("command not found: nvidia-smi");
      },
    });
    expect(handle.isAvailable()).toBe(false);
    expect(handle.getGpuStates()).toHaveLength(0);
  });

  it("initializes when nvidia-smi is available", async () => {
    handle = await initGpuMetrics(makeCfg(), makeSmiDeps(SAMPLE_SMI_OUTPUT));
    expect(handle.isAvailable()).toBe(true);
    expect(handle.getGpuStates()).toHaveLength(2);
  });
});

describe("GPU Metrics - metric registration", () => {
  let handle: GpuMetricsHandle;

  beforeEach(() => {
    mockAuditLogSync.mockClear();
  });

  afterEach(async () => {
    if (handle) await handle.shutdown();
  });

  it("updates Prometheus metrics on poll", async () => {
    const { metrics } = await import("../monitoring/metrics.js");

    handle = await initGpuMetrics(makeCfg(), makeSmiDeps(SINGLE_GPU_OUTPUT));

    expect(metrics.gpuUtilization.set).toHaveBeenCalledWith(
      { gpu_index: "0", gpu_name: "NVIDIA H100" },
      92,
    );
    expect(metrics.gpuTemperature.set).toHaveBeenCalledWith(
      { gpu_index: "0", gpu_name: "NVIDIA H100" },
      75,
    );
    expect(metrics.gpuPowerDraw.set).toHaveBeenCalledWith(
      { gpu_index: "0", gpu_name: "NVIDIA H100" },
      380,
    );
  });

  it("converts memory from MiB to bytes", async () => {
    const { metrics } = await import("../monitoring/metrics.js");

    handle = await initGpuMetrics(makeCfg(), makeSmiDeps(SINGLE_GPU_OUTPUT));

    expect(metrics.gpuMemoryUsed.set).toHaveBeenCalledWith(
      { gpu_index: "0", gpu_name: "NVIDIA H100" },
      72090 * 1024 * 1024,
    );
  });
});

describe("GPU Metrics - threshold alerting", () => {
  let handle: GpuMetricsHandle;

  beforeEach(() => {
    mockAuditLogSync.mockClear();
  });

  afterEach(async () => {
    if (handle) await handle.shutdown();
  });

  it("does not emit threshold event when values are below threshold", async () => {
    const belowThreshold =
      "0, NVIDIA A100, 50, 40, 81920, 32768, 49152, 55, 200.00, 400.00, 30, P0";
    handle = await initGpuMetrics(makeCfg(), makeSmiDeps(belowThreshold));
    expect(mockAuditLogSync).not.toHaveBeenCalled();
  });

  it("emits threshold event when GPU utilization exceeds threshold", async () => {
    const highUtil = "0, NVIDIA A100, 98, 40, 81920, 32768, 49152, 55, 200.00, 400.00, 30, P0";
    handle = await initGpuMetrics(makeCfg(), makeSmiDeps(highUtil));
    expect(mockAuditLogSync).toHaveBeenCalledWith(
      expect.objectContaining({
        action: GPU_AUDIT_ACTIONS.GPU_THRESHOLD_EXCEEDED,
        metadata: expect.objectContaining({
          gpuIndex: 0,
          metricName: "gpuUtilization",
          currentValue: 98,
          threshold: 95,
        }),
      }),
    );
  });

  it("emits threshold event when temperature exceeds threshold", async () => {
    const highTemp = "0, NVIDIA A100, 50, 40, 81920, 32768, 49152, 90, 200.00, 400.00, 30, P0";
    handle = await initGpuMetrics(makeCfg(), makeSmiDeps(highTemp));
    expect(mockAuditLogSync).toHaveBeenCalledWith(
      expect.objectContaining({
        action: GPU_AUDIT_ACTIONS.GPU_THRESHOLD_EXCEEDED,
        metadata: expect.objectContaining({
          metricName: "temperature",
          currentValue: 90,
          threshold: 85,
        }),
      }),
    );
  });

  it("emits threshold event when power draw percent exceeds threshold", async () => {
    const highPower = "0, NVIDIA A100, 50, 40, 81920, 32768, 49152, 55, 390.00, 400.00, 30, P0";
    handle = await initGpuMetrics(makeCfg(), makeSmiDeps(highPower));
    expect(mockAuditLogSync).toHaveBeenCalledWith(
      expect.objectContaining({
        action: GPU_AUDIT_ACTIONS.GPU_THRESHOLD_EXCEEDED,
        metadata: expect.objectContaining({
          metricName: "powerDraw",
        }),
      }),
    );
  });
});

describe("GPU Metrics - shutdown", () => {
  it("clears global handle on shutdown", async () => {
    const handle = await initGpuMetrics(makeCfg(), makeSmiDeps(SAMPLE_SMI_OUTPUT));
    expect(getGpuMetricsHandle()).not.toBeNull();
    await handle.shutdown();
    expect(getGpuMetricsHandle()).toBeNull();
  });
});

describe("GPU Audit Actions", () => {
  it("follows naming convention", () => {
    expect(GPU_AUDIT_ACTIONS.GPU_THRESHOLD_EXCEEDED).toBe("nvidia.gpu.threshold_exceeded");
  });
});
